<template>
  <div :dir="isRtlLang(locale) ? 'rtl' : 'ltr'" style="width: fit-content">
    <v-popover
      trigger="hover"
      v-if="token.content !== ''"
      v-for="token in tokens"
      :key="token.order + token.typelessOrder"
      :disabled="!token.type && !token.first && !token.last"
      style="display: inline-block"
      placement="top"
    >
      <span
        :class="[
          'text',
          token.type && /^_entity_/g.test(token.type) ? token.type : getCheckData(token.type).level + '-highlight',
          token.first && !isRtlLang(locale) && 'first-char-' + getCheckData('_inconsistencies_firstCharType').level,
          token.first && isRtlLang(locale) && 'first-char-rtl-' + getCheckData('_inconsistencies_firstCharType').level,
          token.last && !isRtlLang(locale) && 'last-char-' + getCheckData('_inconsistencies_lastCharType').level,
          token.last && isRtlLang(locale) && 'last-char-rtl-' + getCheckData('_inconsistencies_lastCharType').level,
          token.type && 'active-token',
          token.type === '_inconsistencies_tags' && '_entity_tags',
          ]"
        :last-char="token.content.slice(-1)"
        :first-char="token.content.slice(0, 1)"
        v-html="escape(token.content.slice(Number(token.first), token.content.length - Number(token.last)))"
      >
     </span>
      <template slot="popover">
        <div>
          <div v-if="token.type">
            <CheckPopoverHeader :check="token.type" />
            <div
              v-if="token.type === '_inconsistencies_writeGood'"
              class="popover-content"
            >
              {{ getWriteGoodReason(token.content) }}
            </div>
            <div
              v-if="token.type === '_inconsistencies_insensitiveness'"
              class="popover-content"
            >
              {{ getInsensitivenessReason(token.content) }}
            </div>
            <div
              v-if="token.type === '_inconsistencies_tags'"
              class="popover-content"
            >
              Disallowed HTML tag
            </div>
            <div
              v-if="token.type === '_inconsistencies_dynamic'"
              class="popover-content"
            >
              Value <strong>{{ token.content }}</strong> might change overtime. Consider using placeholder.
            </div>
            <div
              v-if="token.type === '_inconsistencies_typos'"
              class="popover-content"
            >
              <p>Couldn't find word "{{ token.content }}" in dictionary</p>
              <b-button
                @click="addWordToDict(token.content)"
                :disabled="dictsExpansionData && dictsExpansionData[locale] && Object.values(dictsExpansionData[locale]).includes(token.content)"
                variant="outline-success"
                size="sm"
              >
                add to {{ locale }} dictionary
              </b-button>
              <div class="note">note: please take in mind that changes in dictionaries will be visible after next spellchecking (&lt;1 min)</div>
            </div>
          </div>
          <div
            v-if="token.first"
          >
            <CheckPopoverHeader check="_inconsistencies_firstCharType" />
            <div
              class="popover-content"
            >
              First character is
              <strong>{{ firstCharType[0] }}</strong>
              but expected
              <strong>{{ firstCharType[1] }}</strong>
            </div>
          </div>
          <div
            v-if="token.last"
          >
            <CheckPopoverHeader check="_inconsistencies_lastCharType" />
            <div
              class="popover-content"
            >
              Last character is
              <strong>{{ lastCharType[0] }}</strong>
              but expected
              <strong>{{ lastCharType[1] }}</strong>
            </div>
          </div>
        </div>
      </template>
    </v-popover>
  </div>
</template>

<script>
import _ from "lodash"
import { mapGetters } from "vuex"
import rtlDetect from "rtl-detect"
import { FbDb } from "../modules/firebase"
import * as gcFunctions from "../modules/functionsApi"
import CheckPopoverHeader from "./CheckPopoverHeader"

export default {
  name: "Highlighting",
  components: { CheckPopoverHeader },
  props: {
    content: { type: String },
    locale: { type: String },
    placeholders: { type: Array },
    tags: { type: Array },
    disallowedTags: { type: Array },
    dynamics: { type: Array },
    typos: { type: Array },
    firstCharType: { type: Array }, // [actual, expected]
    lastCharType: { type: Array }, // [actual, expected]
    writeGood: { type: Array },
    insensitiveness: { type: Array },
  },
  firebase() {
    return {
      dictsExpansionData: {
        source: FbDb.ref("dictsExpansion/"),
        asObject: true,
      },
    }
  },
  data() {
    return {
      tokens: [],
    }
  },
  created() {
    this.tokens = this.parseContent(this.content)
  },
  computed: {
    ...mapGetters([
      "getCheckData",
    ]),
    writeGoodHighlights() {
      return this.writeGood.map(wg => wg.reason.match(/".+(?=")/m) && wg.reason.match(/".+(?=")/m)[0].slice(1))
    },
    insensitivenessHighLights() {
      const matches = this.insensitiveness.map((ins) => {
        const thinSingleQMarks = Array.isArray(ins.match(/`\w+(?=`)/g)) && ins.match(/`\w+(?=`)/g)[0].slice(1)
        if (thinSingleQMarks) {
          return thinSingleQMarks
        }
        const doubleQMarks = Array.isArray(ins.match(/"\w+(?=")/g)) && ins.match(/"\w+(?=")/g)[0].slice(1)
        return doubleQMarks
      })
      return matches
    },
  },
  methods: {
    getWriteGoodReason(word) {
      return this.writeGood.find(wg => new RegExp(`"${word}(?=")`, "m").test(wg.reason)).reason
    },
    getInsensitivenessReason(word) {
      return this.insensitiveness.find(ins => new RegExp(word, "m").test(ins))
    },
    escape(content) {
      return _.escape(content)
    },
    parseContent(content) {
      let parsedContent = [{
        order: "a",
        typelessOrder: null,
        content,
        type: null,
        first: Array.isArray(this.firstCharType) && this.firstCharType.length === 2 && this.firstCharType[0] !== this.firstCharType[1],
        last: Array.isArray(this.lastCharType) && this.lastCharType.length === 2 && this.lastCharType[0] !== this.lastCharType[1],
      }]
      if (this.writeGood) {
        parsedContent = this.parseTokens(parsedContent, this.writeGoodHighlights, "_inconsistencies_writeGood")
      }
      if (this.typos) {
        parsedContent = this.parseTokens(parsedContent, this.typos, "_inconsistencies_typos")
      }
      if (this.insensitiveness) {
        parsedContent = this.parseTokens(parsedContent, this.insensitivenessHighLights, "_inconsistencies_insensitiveness")
      }
      if (this.disallowedTags) {
        parsedContent = this.parseTokens(parsedContent, this.disallowedTags, "_inconsistencies_tags")
      }
      if (this.tags) {
        parsedContent = this.parseTokens(parsedContent, this.tags, "_entity_tags")
      }
      if (this.placeholders) {
        parsedContent = this.parseTokens(parsedContent, this.placeholders, "_entity_placeholders")
      }
      if (this.dynamics) {
        parsedContent = this.parseTokens(parsedContent, this.dynamics.sort((a, b) => b.length - a.length), "_inconsistencies_dynamic")
      }
      parsedContent.filter(t => !t.type).forEach((token) => {
        // chop remaining typeless tokens to smaller blocks to avoid messing UI
        const newTokens = []
        let counter = 0
        // special splitting for japan and chinese
        if (this.locale.substring(0, 2).toLowerCase() === "zh" || this.locale.substring(0, 2).toLowerCase() === "ja") {
          const splitten = token.content.split("")
          splitten.forEach((word) => {
            newTokens.push({
              order: token.order,
              typelessOrder: counter,
              content: `${word}`,
              type: null,
              first: counter === 0 ? token.first : false,
              last: counter === (splitten.length - 1) ? token.last : false,
            })
            counter += 1
          })
        } else {
          counter = 0
          const splitten = token.content.split(" ")
          splitten.forEach((word) => {
            const isFirst = counter === 0 ? token.first : false
            const isLast = counter === (splitten.length - 1) ? token.last : false
            newTokens.push({
              order: token.order,
              typelessOrder: counter,
              content: counter === (splitten.length - 1) ? `${word}` : `${word} `,
              type: null,
              first: isFirst,
              last: isLast,
            })
            counter += 1
          })
        }
        parsedContent = parsedContent.filter(tkn => tkn.order !== token.order).concat(newTokens)
      })

      const sorted = parsedContent.sort((a, b) => {
        if (a.order < b.order) {
          return -1
        }
        if (a.order > b.order) {
          return 1
        }
        return a.typelessOrder - b.typelessOrder
      })
      return sorted
    },
    parseTokens(chunks, highlights, type) {
      let parsedContent = chunks
      highlights.forEach((highlight) => {
        let regex = {}
        switch (type) {
        case "_inconsistencies_insensitiveness":
        case "_inconsistencies_writeGood":
          regex = new RegExp(`${highlight}(?=[^\\w]|$)`, "g")
          // look behind is not supported in most browser therefore this regex
          // also match highlights inside words that aren't highlights (eg. matches 'he' inside 'the')
          break
        case "_inconsistencies_typos":
          regex = new RegExp(`${_.escapeRegExp(highlight)}(?=[^\\w]|$)`, "g")
          break
        default:
          regex = new RegExp(_.escapeRegExp(highlight), "m")
          break
        }

        const nesting = []
        if (type === "_entity_placeholders") { // allow nesting placeholders inside tags
          nesting.push("_entity_tags")
        }

        parsedContent.filter(token => regex.test(token.content) && (!token.type || nesting.includes(token.type)))
          .forEach((token) => {
            const beforeContent = token.content.slice(0, token.content.search(regex))
            const afterContent = token.content.slice(token.content.search(regex) + highlight.length)
            if (beforeContent !== "") {
              parsedContent.push({
                order: `${token.order}a`,
                typelessOrder: null,
                content: beforeContent,
                type: token.type,
                first: token.first,
                last: false,
              })
            }
            parsedContent.push({
              order: `${token.order}b`,
              typelessOrder: null,
              content: highlight,
              type,
              first: beforeContent === "" ? token.first : false,
              last: afterContent === "" ? token.last : false,
            })
            if (afterContent !== "") {
              parsedContent.push({
                order: `${token.order}c`,
                typelessOrder: null,
                content: afterContent,
                type: token.type,
                first: false,
                last: token.last,
              })
            }
            parsedContent = parsedContent.filter(tkn => tkn.order !== token.order)
          })
      })
      return parsedContent
    },
    addWordToDict(word) {
      FbDb.ref(`dictsExpansion/${this.locale}`).once("value", (snapshot) => {
        if (!Object.values(snapshot.val()).includes(word)) {
          FbDb.ref(`dictsExpansion/${this.locale}`).push(word)
          gcFunctions.inconsistenciesUpdate()
        }
      })
    },
    getEntity(type) {
      switch (type) {
      case "_entity_placeholders":
        return "Placeholder"
      case "_entity_tags":
        return "HTML tag"
      default:
        return ""
      }
    },
    isRtlLang(locale) {
      return rtlDetect.isRtlLang(locale)
    },
  },
}
</script>

<style scoped>
  .active-token {
    border-bottom: rgba(0, 0, 0, 0) solid 1px;
  }
  .active-token:hover {
    border-bottom: solid 1px;
  }
  .error-highlight {
    background-color: rgba(255, 0, 0, 0.24);
  }
  .warning-highlight {
    background-color: rgba(255, 165, 0, 0.4);
  }
  .suggestion-highlight {
    background-color: rgba(0, 123, 255, 0.16);
  }
  ._entity_placeholders {
    color: #26539B;
  }
  ._entity_tags {
    color: #107f9b;
  }
  .first-char-error::before {
    color: red;
    border-left: solid red 2px;
    padding-left: 2px;
    content: attr(first-char);
  }
  .last-char-error::after {
    color: red;
    border-right: solid red 2px;
    padding-right: 2px;
    content: attr(last-char);
  }
  .first-char-warning::before {
    color: #ff7800;
    border-left: solid #ff7800 2px;
    padding-left: 2px;
    content: attr(first-char);
  }
  .last-char-warning::after {
    color: #ff7800;
    border-right: solid #ff7800 2px;
    padding-right: 2px;
    content: attr(last-char);
  }
  .first-char-suggestion::before {
    color: dodgerblue;
    border-left: solid dodgerblue 2px;
    padding-left: 2px;
    content: attr(first-char);
  }
  .last-char-suggestion::after {
    color: dodgerblue;
    border-right: solid dodgerblue 2px;
    padding-right: 2px;
    content: attr(last-char);
  }
  .last-char-rtl-error::after {
    color: red;
    border-left: solid red 2px;
    padding-left: 2px;
    content: attr(last-char);
  }
  .first-char-rtl-error::before {
    color: red;
    border-right: solid red 2px;
    padding-right: 2px;
    content: attr(first-char);
  }
  .last-char-rtl-warning::after {
    color: #ff7800;
    border-left: solid #ff7800 2px;
    padding-left: 2px;
    content: attr(last-char);
  }
  .first-char-rtl-warning::before {
    color: #ff7800;
    border-right: solid #ff7800 2px;
    padding-right: 2px;
    content: attr(first-char);
  }
  .last-char-rtl-suggestion::after {
    color: dodgerblue;
    border-left: solid dodgerblue 2px;
    padding-left: 2px;
    content: attr(last-char);
  }
  .first-char-rtl-suggestion::before {
    color: dodgerblue;
    border-right: solid dodgerblue 2px;
    padding-right: 2px;
    content: attr(first-char);
  }
  .text {
    display: inline-block;
    white-space: pre;
  }
  .strikethrough {
    text-decoration: line-through;
  }
  .style-popover {
    text-align: center;
    width: fit-content;
  }
  .popover-content {
    display: inline-block;
    width: 300px;
    padding: 8px;
    text-align: center;
    font-size: 15px;
    z-index: 5;
  }
  .note {
    font-size: 9px;
    color: gray;
    margin-top: 10px;
  }

</style>
