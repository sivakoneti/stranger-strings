const IMPORTANT_LOCALES = [ // eslint-disable-line
  "en-GB",
  "cs-CZ",
  "da-DK",
  "de-DE",
  "es-ES",
  "fr-FR",
  "it-IT",
  "pl-PL",
  "pt-PT",
  "ru-RU",
  "sv-SE",
  "uk-UA",
  "he-IL",
  "ja-JP",
  "ko-KR",
  "nb-NO",
  "zh-CN-Hans",
  "nl-NL",
]

const DEFAULT_SPELLCHECKING_DICT_SUPPORT = {
  "bg-BG": false,
  "cs-CZ": true,
  "da-DK": false,
  "de-DE": false,
  "el-GR": false,
  "en-GB": true,
  "es-ES": false,
  "fr-FR": false,
  "he-IL": false,
  "hu-HU": false,
  "it-IT": false,
  "lt-LT": false,
  "nb-NO": false,
  "nl-NL": false,
  "pl-PL": false,
  "pt-PT": false,
  "ro-RO": false,
  "ru-RU": false,
  "sk-SK": true,
  "sr-RS": false,
  "sv-SE": false,
  "tr-TR": false,
  "uk-UA": false,
  "vi-VN": false,
}

const DEFAULT_DISABLED_CHECKS = []

const DEFAULT_WRITE_GOOD_SETTINGS = {
  "de-DE": {
    tooWordy: true,
    weasel: true,
  },
  "en-GB": {
    adverb: true,
    cliches: true,
    eprime: false,
    illusion: true,
    passive: true,
    so: true,
    thereIs: true,
    tooWordy: true,
    weasel: true,
  },
}

module.exports = {
  IMPORTANT_LOCALES,
  DEFAULT_SPELLCHECKING_DICT_SUPPORT,
  DEFAULT_WRITE_GOOD_SETTINGS,
  DEFAULT_DISABLED_CHECKS,
  UPDATE_FUNCTION_ENDPOINT: "https://us-central1-stranger-strings-beta-9ce56.cloudfunctions.net/update",
  INCONSISTENCIES_UPDATE_FUNCTION_ENDPOINT: "https://us-central1-stranger-strings-beta-9ce56.cloudfunctions.net/inconsistenciesUpdate",
  COLLECTIONS_UPDATE_FUNCTION_ENDPOINT: "https://us-central1-stranger-strings-beta-9ce56.cloudfunctions.net/collectionsUpdate",
}