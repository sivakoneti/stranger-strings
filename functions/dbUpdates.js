/* eslint-disable no-param-reassign */
// LOCAL DEBUGGING SETTINGS //
const LOCALEXEC = /dbUpdates\.js$/g.test(__filename)

if (LOCALEXEC) {
  require("dotenv").config({ path: "./../.env" }) // eslint-disable-line global-require
}
// //////////////////////// //

const superagent = require("superagent")
const alex = require("alex")
const _ = require("lodash")
const moment = require("moment")
const sanitizeHtml = require("sanitize-html")

const dbMutex = require("./dbMutex")

const { loader, loaderType } = require("./config")

const {
  validateHtml,
  determineCharType,
  grammarNazi,
  detectDynamicValues,
  hasInconsistentLength,
  getLangsWithDiffFirstCharCasing,
  writeGoodCheck,
  updateDictsExpansion,
} = require("./utils")
// TODO: configurable
const {
  DEFAULT_SPELLCHECKING_DICT_SUPPORT,
  DEFAULT_WRITE_GOOD_SETTINGS,
  DEFAULT_PLACEHOLDER_REGEX,
  DEFAULT_INSENSITIVENESS_CONFIG,
} = require("../common/config")


function computeInconsistenciesOfTranslations(val, fbKey, writeGoodSettings, placeholderRegex) {
  const mappedTranslations = {}
  _.forEach(val, (_val, _key) => {
    let trimmed

    if (!_val) {
      trimmed = ""
    } else if (typeof _val !== "string") { // pluralized object
      trimmed = String(Object.values(_val))
    } else {
      trimmed = _val.trim()
    }

    const interpolated = trimmed.replace(RegExp(placeholderRegex, "g"), "XXX")
    _.set(mappedTranslations, [fbKey, _key], {
      content: _val,
      _placeholders: trimmed.match(RegExp(placeholderRegex, "g")) || [],
      _firstCharType: determineCharType(sanitizeHtml(interpolated, { allowedTags: [], allowedAttributes: [] })[0]),
      _lastCharType: determineCharType(sanitizeHtml(interpolated, { allowedTags: [], allowedAttributes: [] })[interpolated.length - 1]),
      _tags: validateHtml(_val),
      _dynamic: detectDynamicValues(_val),
      _writeGood: writeGoodCheck(_val, _key, writeGoodSettings),
      _insensitiveness: _key.toString() === "en-GB" ?
        alex.text(sanitizeHtml(_val, { allowedTags: [], allowedAttributes: [] }), insensitivenessConfig).messages.map(out => out.message) : {},
    })
  })
  return mappedTranslations
}

function computeInconsistenciesOfKey(mappedTranslations, fbKey) {
  const val = {}

  // - thai lang doesn't have sentence ending punctation
  // - japan lang doesn't use question mark
  const lastCharTypeExceptions = mappedTranslations[fbKey]
  && mappedTranslations[fbKey]["en-GB"]
  && mappedTranslations[fbKey]["en-GB"]._lastCharType === "question mark" ? ["th-TH", "ja-JP"] : "th-TH"

  val._inconsistencies_placeholders = mappedTranslations[fbKey] // eslint-disable-line no-param-reassign
    && _.uniqWith(_.map(mappedTranslations[fbKey], x => x._placeholders.sort()), _.isEqual).length !== 1
  val._inconsistencies_firstCharType = mappedTranslations[fbKey] // eslint-disable-line no-param-reassign
    && _.uniq(_.map(mappedTranslations[fbKey], x => x._firstCharType))
      .filter(x => x !== "digit").length > 1
  // DIGIT excluded due to syntax differences between languages
  val._inconsistencies_lastCharType = mappedTranslations[fbKey] // eslint-disable-line no-param-reassign
    && _.uniq(_.map(_.omit(mappedTranslations[fbKey], lastCharTypeExceptions), x => x._lastCharType))
      .filter(x => !["uncategorized", "digit"].includes(x)).length > 1
  // UNCATEGORIZED and DIGIT excluded due to syntax differences between languages
  val._inconsistencies_tags = mappedTranslations[fbKey] // eslint-disable-line no-param-reassign
    && _.includes(_.map(mappedTranslations[fbKey], x => x._tags), "NOT_ALLOWED")
  val._inconsistencies_length = mappedTranslations[fbKey] // eslint-disable-line no-param-reassign
    && hasInconsistentLength(mappedTranslations[fbKey], mappedTranslations[fbKey]["en-GB"] ? mappedTranslations[fbKey]["en-GB"].content.length : 0)
  val._inconsistencies_typos = mappedTranslations[fbKey] // eslint-disable-line no-param-reassign
    && Object.keys(mappedTranslations[fbKey])
      .filter(lang => Array.isArray(mappedTranslations[fbKey][lang]._typos) && mappedTranslations[fbKey][lang]._typos.length > 0)
  val._inconsistencies_writeGood = mappedTranslations[fbKey]
    && Object.keys(mappedTranslations[fbKey])
      .filter(lang => Array.isArray(mappedTranslations[fbKey][lang]._writeGood) && mappedTranslations[fbKey][lang]._writeGood.length > 0)
  val._inconsistencies_dynamic = mappedTranslations[fbKey]
    && Object.values(mappedTranslations[fbKey])
      .some(x => x._dynamic.length > 0)
  val._inconsistencies_insensitiveness = mappedTranslations[fbKey]
    && Object.keys(mappedTranslations[fbKey])
      .filter(lang => Array.isArray(mappedTranslations[fbKey][lang]._insensitiveness) && mappedTranslations[fbKey][lang]._insensitiveness.length > 0)
  return val
}

function computeInconsistenciesOfCollection(collections, translations) {
  _.forEach(collections, (collection) => {
    const translationsOfCollection = _.reduce(collection.keys, (acc, key) => { // get translations from their keys
      acc.push(translations[key])
      return acc
    }, [])
    collection._inconsistencies_firstCharCasing = getLangsWithDiffFirstCharCasing(translationsOfCollection)
  })
  return collections
}

function assignCollectionKeys(collections, keys) {
  _.forEach(collections, (val) => {
    const regex = RegExp(val.regex, val.regexFlags)
    val.keys = keys.filter(x => regex.test(x.replace(/[-]/g, "."))) // keys are in format common-continents-aas instead of common.continents.aas
  })
  return collections || {}
}

function prepareItemsForExport(items) {
  // filter keys exported with linebreaks or other invalid characters
  return _.reduce(items, (acc, val, key) => {
    if (!key.includes("\n")) {
      acc[key] = val
    } else {
      console.error(`invalid key with unsupported characters (omitting): ${key}`)
    }
    return acc
  }, {})
}

function prepareTranslationsForExport(translations) {
  return _.reduce(translations, (acc, val, key) => {
    if (!key.includes("\n")) {
      acc[key] = val
    }
    return acc
  }, {})
}

async function originToFirebase() {
  if (!(await dbMutex.tryLock(`downloading recent translations from ${loaderType}`))) {
    console.log("Update already in progress, stopping!")
    return
  }
  try {
    const { version, translations } = await loader.fetch()

    const items = _.reduce(translations, (acc, val, key) => {
      const _key = key.includes(".") ? key.split(".").join("-") : key

      if (!acc[_key]) {
        acc[_key] = {}
      }
      acc[_key].key = key
      acc[_key]["en-GB"] = val["en-GB"] || null
      acc[_key].count = Object.keys(val).length
      acc[_key].translated = Object.keys(val)

      return acc
    }, {})

    let mappedTranslations = {}
    const writeGoodSettings = (await superagent.get(`${process.env.VUE_APP_FIREBASE_DATABASE_URL}/writeGood.json`)).body
      || DEFAULT_WRITE_GOOD_SETTINGS
    const placeholderRegex = (await superagent.get(`${process.env.VUE_APP_FIREBASE_DATABASE_URL}/placeholders/regex.json`)).body
      || DEFAULT_PLACEHOLDER_REGEX
    const insensitivenessConfig = (await superagent.get(`${process.env.VUE_APP_FIREBASE_DATABASE_URL}/insensitivenessConfig.json`)).body
      || DEFAULT_INSENSITIVENESS_CONFIG

    _.forEach(translations, (val, key) => {
      const fbKey = key.includes(".") ? key.split(".").join("-") : key

      mappedTranslations = {
        ...mappedTranslations,
        ...computeInconsistenciesOfTranslations(val, fbKey, writeGoodSettings, placeholderRegex, insensitivenessConfig),
      }
    })

    const dictsExpansion = updateDictsExpansion(
      (await superagent.get(`${process.env.VUE_APP_FIREBASE_DATABASE_URL}/dictsExpansion.json`)).body,
      DEFAULT_SPELLCHECKING_DICT_SUPPORT,
    )
    await superagent.put(`${process.env.VUE_APP_FIREBASE_DATABASE_URL}/dictsExpansion.json`).send(dictsExpansion)
    mappedTranslations = grammarNazi(mappedTranslations, dictsExpansion, DEFAULT_SPELLCHECKING_DICT_SUPPORT, placeholderRegex)

    _.forEach(items, (val, key) => {
      const fbKey = key.includes(".") ? key.split(".").join("-") : key

      items[key] = { ...val, ...computeInconsistenciesOfKey(mappedTranslations, fbKey) }
    })

    let collections = (await superagent.get(`${process.env.VUE_APP_FIREBASE_DATABASE_URL}/collections.json`)).body
    collections = assignCollectionKeys(collections, Object.keys(mappedTranslations))
    collections = computeInconsistenciesOfCollection(collections, mappedTranslations)

    const finalItems = prepareItemsForExport(items)
    const finalTranslations = prepareTranslationsForExport(mappedTranslations)

    console.log("removing old data")
    await superagent.delete(`${process.env.VUE_APP_FIREBASE_DATABASE_URL}/lastUpdate.json`)
    await superagent.delete(`${process.env.VUE_APP_FIREBASE_DATABASE_URL}/items.json`)
    await superagent.delete(`${process.env.VUE_APP_FIREBASE_DATABASE_URL}/translations.json`)
    await superagent.delete(`${process.env.VUE_APP_FIREBASE_DATABASE_URL}/collections.json`)

    console.log("uploading new keys")
    await superagent.put(`${process.env.VUE_APP_FIREBASE_DATABASE_URL}/items.json`).send(finalItems)
    await superagent.put(`${process.env.VUE_APP_FIREBASE_DATABASE_URL}/translations.json`).send(finalTranslations)
    await superagent.put(`${process.env.VUE_APP_FIREBASE_DATABASE_URL}/collections.json`).send(collections)

    await superagent
      .put(`${process.env.VUE_APP_FIREBASE_DATABASE_URL}/locales.json`)
      .send({
        list: [...new Set(_.reduce(translations, (acc, translation) => acc.concat(Object.keys(translation)), []))],
      })

    await superagent
      .put(`${process.env.VUE_APP_FIREBASE_DATABASE_URL}/lastUpdate.json`)
      .send({
        updated: moment().format("DD-MM-YYYY HH:mm:ss"),
        version,
      })
    console.log("SUCCESS: updated all translations")
    // eslint-disable-next-line consistent-return
    return "SUCCESS: updated all translations"
  } finally {
    await dbMutex.unlock()
  }
}

async function updateInconsistencies() {
  if (!(await dbMutex.tryLock("updating inconsistencies"))) {
    console.log("Update already in progress, stopping!")
    return
  }
  try {
    let items = (await superagent.get(`${process.env.VUE_APP_FIREBASE_DATABASE_URL}/items.json`)).body
    let translations = (await superagent.get(`${process.env.VUE_APP_FIREBASE_DATABASE_URL}/translations.json`)).body
    const writeGoodSettings = (await superagent.get(`${process.env.VUE_APP_FIREBASE_DATABASE_URL}/writeGood.json`)).body
      || DEFAULT_WRITE_GOOD_SETTINGS
    const placeholderRegex = (await superagent.get(`${process.env.VUE_APP_FIREBASE_DATABASE_URL}/placeholders/regex.json`)).body
      || DEFAULT_PLACEHOLDER_REGEX
    const insensitivenessConfig = (await superagent.get(`${process.env.VUE_APP_FIREBASE_DATABASE_URL}/insensitivenessConfig.json`)).body
      || DEFAULT_INSENSITIVENESS_CONFIG

    _.forEach(translations, (val, key) => {
      _.forEach(val, (x, locKey) => { val[locKey] = x.content }) // strip locale of everything except translation content
      translations = {
        ...translations,
        ...computeInconsistenciesOfTranslations(val, key, writeGoodSettings, placeholderRegex, insensitivenessConfig),
      }
    })

    const dictsExpansion = updateDictsExpansion(
      (await superagent.get(`${process.env.VUE_APP_FIREBASE_DATABASE_URL}/dictsExpansion.json`)).body,
      DEFAULT_SPELLCHECKING_DICT_SUPPORT,
    )
    await superagent.put(`${process.env.VUE_APP_FIREBASE_DATABASE_URL}/dictsExpansion.json`).send(dictsExpansion)
    translations = grammarNazi(translations, dictsExpansion, DEFAULT_SPELLCHECKING_DICT_SUPPORT, placeholderRegex)

    _.forEach(items, (val, key) => {
      items[key] = { ...val, ...computeInconsistenciesOfKey(translations, key) }
    })

    items = prepareItemsForExport(items)
    translations = prepareTranslationsForExport(translations)

    console.log("removing old data")
    await superagent.delete(`${process.env.VUE_APP_FIREBASE_DATABASE_URL}/items.json`)
    await superagent.delete(`${process.env.VUE_APP_FIREBASE_DATABASE_URL}/translations.json`)

    console.log("uploading new keys")
    await superagent.put(`${process.env.VUE_APP_FIREBASE_DATABASE_URL}/items.json`).send(items)
    await superagent.put(`${process.env.VUE_APP_FIREBASE_DATABASE_URL}/translations.json`).send(translations)

    console.log("SUCCESS: updated all inconsistencies")
    // eslint-disable-next-line consistent-return
    return "SUCCESS: updated all inconsistencies"
  } finally {
    await dbMutex.unlock()
  }
}

async function updateCollections() {
  if (!(await dbMutex.tryLock("updating collections"))) {
    console.log("Update already in progress, stopping!")
    return
  }
  try {
    const translations = (await superagent.get(`${process.env.VUE_APP_FIREBASE_DATABASE_URL}/translations.json`)).body
    let collections = (await superagent.get(`${process.env.VUE_APP_FIREBASE_DATABASE_URL}/collections.json`)).body

    collections = assignCollectionKeys(collections, Object.keys(translations))
    collections = computeInconsistenciesOfCollection(collections, translations)

    console.log("removing old data")
    await superagent.delete(`${process.env.VUE_APP_FIREBASE_DATABASE_URL}/collections.json`)

    console.log("uploading new collections")
    await superagent.put(`${process.env.VUE_APP_FIREBASE_DATABASE_URL}/collections.json`).send(collections)

    console.log("SUCCESS: updated all collections")
    // eslint-disable-next-line consistent-return
    return "SUCCESS: updated all collections"
  } finally {
    await dbMutex.unlock()
  }
}

module.exports = {
  originToFirebase,
  updateInconsistencies,
  updateCollections,
}

// LOCAL DEBUGGING SETTINGS //
if (LOCALEXEC) originToFirebase()
// //////////////////////// //
