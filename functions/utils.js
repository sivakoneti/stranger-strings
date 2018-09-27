/* eslint-disable global-require */
const XRegExp = require("xregexp")
const sanitizeHtml = require("sanitize-html")
const fs = require("fs")
const path = require("path")
const nspell = require("nspell")
const _ = require("lodash")
const writeGood = require("write-good")
const schreibGut = require("schreib-gut")

const { spellcheck } = require("./spellcheck")
const maxExpansionRatio = require("../common/maxExpansionRatio")

function loadNspell(name) {
  return {
    aff: fs.readFileSync(path.join("node_modules", name, "index.aff"), "utf-8"),
    dic: fs.readFileSync(path.join("node_modules", name, "index.dic"), "utf-8"),
  }
}

const nspellDicts = {
  "bg-BG": loadNspell("dictionary-bg"),
  "cs-CZ": loadNspell("dictionary-cs"),
  "da-DK": loadNspell("dictionary-da"),
  "de-DE": loadNspell("dictionary-de"),
  "el-GR": loadNspell("dictionary-el"),
  "en-GB": loadNspell("dictionary-en-gb"),
  "es-ES": loadNspell("dictionary-es"),
  "fr-FR": loadNspell("dictionary-fr"),
  "he-IL": loadNspell("dictionary-he"),
  "hu-HU": loadNspell("dictionary-hu"),
  "it-IT": loadNspell("dictionary-it"),
  "lt-LT": loadNspell("dictionary-lt"),
  "nb-NO": loadNspell("dictionary-nb"),
  "nl-NL": loadNspell("dictionary-nl"),
  "pl-PL": loadNspell("dictionary-pl"),
  "pt-PT": loadNspell("dictionary-pt"),
  "ro-RO": loadNspell("dictionary-ro"),
  "ru-RU": loadNspell("dictionary-ru"),
  "sk-SK": loadNspell("dictionary-sk"),
  "sr-RS": loadNspell("dictionary-sr"),
  "sv-SE": loadNspell("dictionary-sv"),
  "tr-TR": loadNspell("dictionary-tr"),
  "uk-UA": loadNspell("dictionary-uk"),
  "vi-VN": loadNspell("dictionary-vi"),
}

function determineCharType(char) {
  switch (char) {
  case ":":
  case "：":
    return "COLON"
  case ".":
  case "。":
  case "…":
    return "DOT"
  case ",":
    return "COMMA"
  case "_":
    return "UNDERSCORE"
  case " ":
    return "SPACE"
  case "¿": // spanish beginning of a sentence ending with question/exclamation mark
  case "¡":
    return "LETTER"
  case "!":
  case "！":
    return "EXCLMARK"
  case "?":
  case ";":
  case "؟":
  case "？":
    return "QUESTMARK"
  case "\n":
    return "LINEBREAK"
  default:
    switch (true) {
    case /\d/.test(char):
      return "DIGIT"
    case XRegExp("\\pL").test(char):
      return "LETTER"
    default:
      return "UNCATEGORIZED"
    }
  }
}

function validateHtml(html) {
  const htmlSanitizedEverythingAllowed = sanitizeHtml(html, {
    allowedTags: false, // allow all tags
    allowedAttributes: false, // allow all attributes
  })
  const htmlSanitizedWhitelistedAllowed = sanitizeHtml(html, {
    allowedTags: ["br", "a", "strong", "em", "span", "i"], // found and blacklisted: ul, li, ol, div, b, p
    allowedAttributes: false, // allow all attributes
  })
  return htmlSanitizedEverythingAllowed === htmlSanitizedWhitelistedAllowed ? "" : "NOT_ALLOWED"
}

function loadDicts(dictsExpansion, activatedDicts) {
  // eslint-disable-next-line global-require
  const custom = dictsExpansion || {}

  const ownDicts = fs.readdirSync("./dicts")
    .filter(file => file.includes(".dic"))
    .map(file => file.substring(0, 5))
  return Object.keys(activatedDicts)
    .filter(lang => activatedDicts[lang])
    .reduce((acc, lang) => {
      let dict
      if (ownDicts.includes(lang)) {
        dict = nspell(
          fs.readFileSync(`./dicts/${lang}.aff`),
          fs.readFileSync(`./dicts/${lang}.dic`),
        )
      } else {
        dict = nspell(nspellDicts[lang])
      }
      _.concat(
        custom.global || [],
        custom[lang] || [],
      ).forEach(word => dict.add(word))
      acc[lang] = dict
      return acc
    }, {})
}

function grammarNazi(locales, dictsExpansion, activatedDicts) {
  // {
  //   'en-GB': NspellDictinary
  //   …
  // }
  const dicts = loadDicts(dictsExpansion, activatedDicts)

  _.forEach(locales, (loc) => {
    _.forEach(loc, (locData, file) => {
      const lang = file.substr(0, 5)
      const txt = locData.content.replace(/<(?:.|\n)*?>/gm, " ").replace(/(__\w+__)/g, "") // replace tags with space and remove placeholders
      let unrecognized
      if (lang in dicts) {
        unrecognized = []
        spellcheck(dicts[lang], txt).forEach((typo) => {
          unrecognized.push(typo)
        })
      } else {
        unrecognized = "unsupported language"
      }
      // eslint-disable-next-line no-param-reassign
      locData._typos = unrecognized
    })
  })
  return locales
}

function writeGoodCheck(content, lang, writeGoodSettings) {
  if (lang === "en-GB") {
    return writeGood(sanitizeHtml(content, { allowedTags: [], allowedAttributes: [] }), writeGoodSettings[lang])
  }
  if (lang === "de-DE") {
    return writeGood(sanitizeHtml(content, { allowedTags: [], allowedAttributes: [] }), { ...writeGoodSettings[lang], ...{ checks: schreibGut } })
  }
  return {}
}

const DYNAMIC_IGNORE = ["24/7", "7/24"]
function detectDynamicValues(input) {
  return (
    input.match(/(\d+([.,/]*\s*\d+)*)+/g) || []
  ).filter(word => !DYNAMIC_IGNORE.includes(word))
}

function hasInconsistentLength(translations, baseLength) {
  if (!baseLength) {
    return false
  }

  return Object.values(translations).some((translation) => {
    const tLength = translation.content.length
    return (tLength / baseLength) > maxExpansionRatio(baseLength)
  })
}

function getLangsWithDiffFirstCharCasing(translations) {
  if (translations.length < 2) {
    return []
  }

  return _.reduce(translations[0], (acc, transl, lang) => {
    const firstChars = []
    _.forEach(translations, (t) => {
      const firstChar = t[lang] && t[lang].content.charAt(0)
      if (typeof firstChar === "string") {
        firstChars.push(firstChar)
      }
    })
    if (_.uniq(_.map(firstChars, ch => ch === ch.toUpperCase())).length > 1) {
      acc.push(lang)
    }
    return acc
  }, [])
}

// function for setting up empty instance for new languages in dictionary expansion
function updateDictsExpansion(dictsExpansion) {
  const activeDicts = fs.readdirSync("./dicts").filter(file => file.includes(".dic")).map(dict => dict.substring(0, 5))
  const dictsExpUpdate = activeDicts.reduce((acc, val) => {
    if (!dictsExpansion || !Object.keys(dictsExpansion).includes(val)) {
      acc[val] = ["**PLACEHOLDER**"]
    }
    return acc
  }, {})
  if (!dictsExpansion || !dictsExpansion.global) {
    dictsExpUpdate.global = ["**PLACEHOLDER**"]
  }
  return { ...dictsExpUpdate, ...dictsExpansion }
}

module.exports = {
  determineCharType,
  validateHtml,
  grammarNazi,
  detectDynamicValues,
  hasInconsistentLength,
  getLangsWithDiffFirstCharCasing,
  writeGoodCheck,
  updateDictsExpansion,
}
