(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
const toDateObject = require('./wikidata_time_to_date_object')

const helpers = {}
helpers.isNumericId = id => /^[1-9][0-9]*$/.test(id)
helpers.isEntityId = id => /^(Q|P)[1-9][0-9]*$/.test(id)
helpers.isItemId = id => /^Q[1-9][0-9]*$/.test(id)
helpers.isPropertyId = id => /^P[1-9][0-9]*$/.test(id)
helpers.isGuid = guid => /^(Q|P|L)\d+\$[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(guid)

helpers.getNumericId = function (id) {
  if (!(helpers.isEntityId(id))) throw new Error(`invalid wikidata id: ${id}`)
  return id.replace(/Q|P/, '')
}

helpers.wikidataTimeToDateObject = toDateObject

// Try to parse the date or return the input
const bestEffort = fn => value => {
  try {
    return fn(value)
  } catch (err) {
    value = value.time || value

    const sign = value[0]
    let [ yearMonthDay, withinDay ] = value.slice(1).split('T')
    yearMonthDay = yearMonthDay.replace(/-00/g, '-01')

    return `${sign}${yearMonthDay}T${withinDay}`
  }
}

const toEpochTime = wikidataTime => toDateObject(wikidataTime).getTime()
const toISOString = wikidataTime => toDateObject(wikidataTime).toISOString()

// A date format that knows just three precisions:
// 'yyyy', 'yyyy-mm', and 'yyyy-mm-dd' (including negative and non-4 digit years)
// Should be able to handle the old and the new Wikidata time:
// - in the old one, units below the precision where set to 00
// - in the new one, those months and days are set to 01 in those cases,
//   so when we can access the full claim object, we check the precision
//   to recover the old format
const toSimpleDay = wikidataTime => {
  // Also accept claim datavalue.value objects, and actually prefer those,
  // as we can check the precision
  if (typeof wikidataTime === 'object') {
    const { time, precision } = wikidataTime
    // Year precision
    if (precision === 9) wikidataTime = time.replace('-01-01T', '-00-00T')
    // Month precision
    else if (precision === 10) wikidataTime = time.replace('-01T', '-00T')
    else wikidataTime = time
  }

  return wikidataTime.split('T')[0]
  // Remove positive years sign
  .replace(/^\+/, '')
  // Remove years padding zeros
  .replace(/^(-?)0+/, '$1')
  // Remove days if not included in the Wikidata date precision
  .replace(/-00$/, '')
  // Remove months if not included in the Wikidata date precision
  .replace(/-00$/, '')
}

helpers.wikidataTimeToEpochTime = bestEffort(toEpochTime)
helpers.wikidataTimeToISOString = bestEffort(toISOString)
helpers.wikidataTimeToSimpleDay = bestEffort(toSimpleDay)

helpers.getImageUrl = (filename, width) => {
  var url = `https://commons.wikimedia.org/wiki/Special:FilePath/${filename}`
  if (typeof width === 'number') url += `?width=${width}`
  return url
}

module.exports = helpers

},{"./wikidata_time_to_date_object":11}],2:[function(require,module,exports){
const { wikidataTimeToISOString, wikidataTimeToEpochTime, wikidataTimeToSimpleDay } = require('./helpers')

const simple = datavalue => datavalue.value

const monolingualtext = (datavalue, options) => {
  return options.keepRichValues ? datavalue.value : datavalue.value.text
}

const entity = (datavalue, options) => prefixedId(datavalue, options.entityPrefix)

const entityLetter = {
  item: 'Q',
  lexeme: 'L',
  property: 'P'
}

const prefixedId = function (datavalue, prefix) {
  const { value } = datavalue
  const id = value.id || entityLetter[value['entity-type']] + value['numeric-id']
  return typeof prefix === 'string' ? `${prefix}:${id}` : id
}

const quantity = (datavalue, options) => {
  const { value } = datavalue
  const amount = parseFloat(value.amount)
  if (options.keepRichValues) {
    const amount = parseFloat(value.amount)
    const unit = value.unit.replace('http://www.wikidata.org/entity/', '')
    const upperBound = parseFloat(value.upperBound)
    const lowerBound = parseFloat(value.lowerBound)
    return { amount, unit, upperBound, lowerBound }
  } else {
    return amount
  }
}

const coordinate = datavalue => {
  return [ datavalue.value.latitude, datavalue.value.longitude ]
}

const time = (datavalue, options) => {
  return getTimeConverter(options.timeConverter)(datavalue.value)
}

const getTimeConverter = (key = 'iso') => timeConverters[key]

// Each time converter should be able to accept 2 keys of arguments:
// - either datavalue.value objects (prefered as it gives access to the precision)
// - or the time string (datavalue.value.time)
const timeConverters = {
  iso: wikidataTimeToISOString,
  epoch: wikidataTimeToEpochTime,
  'simple-day': wikidataTimeToSimpleDay,
  none: wikidataTime => wikidataTime.time || wikidataTime
}

const parsers = {
  string: simple,
  commonsMedia: simple,
  url: simple,
  'external-id': simple,
  math: simple,
  monolingualtext,
  'wikibase-item': entity,
  'wikibase-lexeme': entity,
  'wikibase-property': entity,
  time,
  quantity,
  'globe-coordinate': coordinate,
  'geo-shape': simple,
  'tabular-data': simple,
  'musical-notation': simple
}

module.exports = {
  parsers,
  parse: (datatype, datavalue, options, claimId) => {
    if (!datatype) {
      // Ex: https://www.wikidata.org/w/index.php?title=Q2105758&oldid=630350590
      console.error('invalid claim', claimId)
      return null
    }

    try {
      return parsers[datatype](datavalue, options)
    } catch (err) {
      if (err.message === 'parsers[datatype] is not a function') {
        err.message = `${datatype} claim parser isn't implemented
        Claim id: ${claimId}
        Please report to https://github.com/maxlath/wikidata-sdk/issues`
      }
      throw err
    }
  }
}

},{"./helpers":1}],3:[function(require,module,exports){
const { simplifyEntity } = require('./simplify_entity')

module.exports = {
  wd: {
    entities: function (res) {
      res = res.body || res
      const { entities } = res
      Object.keys(entities).forEach(entityId => {
        entities[entityId] = simplifyEntity(entities[entityId])
      })
      return entities
    }
  }
}

},{"./simplify_entity":5}],4:[function(require,module,exports){
const { parse: parseClaim } = require('./parse_claim')
const { uniq } = require('../utils/utils')

// Expects an entity 'claims' object
// Ex: entity.claims
const simplifyClaims = function (claims, ...options) {
  const { propertyPrefix } = parseOptions(options)
  const simpleClaims = {}
  for (let id in claims) {
    let propClaims = claims[id]
    if (propertyPrefix) {
      id = propertyPrefix + ':' + id
    }
    simpleClaims[id] = simplifyPropertyClaims(propClaims, ...options)
  }
  return simpleClaims
}

// Expects the 'claims' array of a particular property
// Ex: entity.claims.P369
const simplifyPropertyClaims = function (propClaims, ...options) {
  // Avoid to throw on empty inputs to allow to simplify claims array
  // without having to know if the entity as claims for this property
  // Ex: simplifyPropertyClaims(entity.claims.P124211616)
  if (propClaims == null || propClaims.length === 0) return []

  const { keepNonTruthy, areSubSnaks } = parseOptions(options)
  if (!(keepNonTruthy || areSubSnaks)) {
    propClaims = truthyPropertyClaims(propClaims)
  }

  propClaims = propClaims
    .map(claim => simplifyClaim(claim, ...options))
    // Filter-out novalue and somevalue claims,
    // unless a novalueValue or a somevalueValue is passed in options
    .filter(defined)

  // Deduplicate values unless we return a rich value object
  if (propClaims[0] && typeof propClaims[0] !== 'object') {
    return uniq(propClaims)
  } else {
    return propClaims
  }
}

const aggregatePerRank = function (aggregate, claim) {
  const { rank } = claim
  aggregate[rank] || (aggregate[rank] = [])
  aggregate[rank].push(claim)
  return aggregate
}

const truthyPropertyClaims = function (propClaims) {
  const aggregate = propClaims.reduce(aggregatePerRank, {})
  // on truthyness: https://www.mediawiki.org/wiki/Wikibase/Indexing/RDF_Dump_Format#Truthy_statements
  return aggregate.preferred || aggregate.normal || []
}

const truthyClaims = function (claims) {
  const truthClaimsOnly = {}
  Object.keys(claims).forEach(property => {
    truthClaimsOnly[property] = truthyPropertyClaims(claims[property])
  })
  return truthClaimsOnly
}

// Considers null as defined
const defined = obj => obj !== undefined

// Expects a single claim object
// Ex: entity.claims.P369[0]
const simplifyClaim = function (claim, ...options) {
  options = parseOptions(options)
  const { keepQualifiers, keepReferences, keepIds, keepHashes, keepTypes, keepSnaktypes, keepRanks } = parseKeepOptions(options)

  // tries to replace wikidata deep claim object by a simple value
  // e.g. a string, an entity Qid or an epoch time number
  const { mainsnak, rank } = claim

  var value, datatype, datavalue, snaktype, isQualifierSnak, isReferenceSnak
  if (mainsnak) {
    datatype = mainsnak.datatype
    datavalue = mainsnak.datavalue
    snaktype = mainsnak.snaktype
  } else {
    // Qualifiers have no mainsnak, and define datatype, datavalue on claim
    datavalue = claim.datavalue
    datatype = claim.datatype
    snaktype = claim.snaktype
    // Duck typing the sub-snak type
    if (claim.hash) isQualifierSnak = true
    else isReferenceSnak = true
  }

  if (datavalue) {
    value = parseClaim(datatype, datavalue, options, claim.id)
  } else {
    if (snaktype === 'somevalue') value = options.somevalueValue
    else if (snaktype === 'novalue') value = options.novalueValue
    else throw new Error('no datavalue or special snaktype found')
  }

  // Qualifiers should not attempt to keep sub-qualifiers or references
  if (isQualifierSnak) {
    if (!(keepHashes || keepTypes)) return value

    const richValue = { value }

    if (keepHashes) richValue.hash = claim.hash
    if (keepTypes) richValue.type = datatype

    return richValue
  }

  if (isReferenceSnak) {
    if (!keepTypes) return value

    return { type: datatype, value }
  }

  // No need to test keepHashes as it has no effect if neither
  // keepQualifiers or keepReferences is true
  if (!(keepQualifiers || keepReferences || keepIds || keepTypes || keepSnaktypes || keepRanks)) {
    return value
  }

  // When keeping qualifiers or references, the value becomes an object
  // instead of a direct value
  const richValue = { value }

  if (keepTypes) richValue.type = datatype

  if (keepSnaktypes) richValue.snaktype = snaktype

  if (keepRanks) richValue.rank = rank

  const subSnaksOptions = getSubSnakOptions(options)
  subSnaksOptions.keepHashes = keepHashes

  if (keepQualifiers) {
    richValue.qualifiers = simplifyClaims(claim.qualifiers, subSnaksOptions)
  }

  if (keepReferences) {
    claim.references = claim.references || []
    richValue.references = claim.references.map(refRecord => {
      const snaks = simplifyClaims(refRecord.snaks, subSnaksOptions)
      if (keepHashes) return { snaks, hash: refRecord.hash }
      else return snaks
    })
  }

  if (keepIds) richValue.id = claim.id

  return richValue
}

const parseOptions = function (options) {
  if (options == null) return {}

  if (options[0] && typeof options[0] === 'object') return options[0]

  // Legacy interface
  var [ entityPrefix, propertyPrefix, keepQualifiers ] = options
  return { entityPrefix, propertyPrefix, keepQualifiers }
}

const simplifyQualifiers = (claims, options) => {
  return simplifyClaims(claims, getSubSnakOptions(options))
}

const simplifyPropertyQualifiers = (propClaims, options) => {
  return simplifyPropertyClaims(propClaims, getSubSnakOptions(options))
}

// Using a new object so that the original options object isn't modified
const getSubSnakOptions = options => {
  return Object.assign({}, options, { areSubSnaks: true })
}

const keepOptions = [ 'keepQualifiers', 'keepReferences', 'keepIds', 'keepHashes', 'keepTypes', 'keepSnaktypes', 'keepRanks' ]
const parseKeepOptions = options => {
  if (options.keepAll) {
    keepOptions.forEach(optionName => {
      if (options[optionName] == null) options[optionName] = true
    })
  }
  return options
}

module.exports = {
  simplifyClaims,
  simplifyPropertyClaims,
  simplifyClaim,
  truthyClaims,
  truthyPropertyClaims,
  simplifyQualifiers,
  simplifyPropertyQualifiers,
  simplifyQualifier: simplifyClaim
}

},{"../utils/utils":22,"./parse_claim":2}],5:[function(require,module,exports){
const { simplifyClaims } = require('./simplify_claims')
const simplify = require('./simplify_text_attributes')
const simplifySitelinks = require('./simplify_sitelinks')

const simplifyEntity = (entity, options) => {
  const simplified = {
    id: entity.id,
    type: entity.type,
    modified: entity.modified
  }

  simplifyIfDefined(entity, simplified, 'labels')
  simplifyIfDefined(entity, simplified, 'descriptions')
  simplifyIfDefined(entity, simplified, 'aliases')

  if (entity.claims != null) {
    simplified.claims = simplifyClaims(entity.claims, options)
  }

  if (entity.sitelinks != null) {
    simplified.sitelinks = simplifySitelinks(entity.sitelinks, options)
  }

  return simplified
}

const simplifyIfDefined = (entity, simplified, attribute) => {
  if (entity[attribute] != null) {
    simplified[attribute] = simplify[attribute](entity[attribute])
  }
}

const simplifyEntities = (entities, options = {}) => {
  const { entityPrefix } = options
  return Object.keys(entities).reduce((obj, key) => {
    const entity = entities[key]
    if (entityPrefix) key = `${entityPrefix}:${key}`
    obj[key] = simplifyEntity(entity, options)
    return obj
  }, {})
}

module.exports = { simplifyEntity, simplifyEntities }

},{"./simplify_claims":4,"./simplify_sitelinks":6,"./simplify_text_attributes":8}],6:[function(require,module,exports){
const { getSitelinkUrl } = require('./sitelinks_helpers')

module.exports = (sitelinks, options = {}) => {
  const { addUrl } = options
  return Object.keys(sitelinks).reduce(aggregateValues(sitelinks, addUrl), {})
}

const aggregateValues = (sitelinks, addUrl) => (index, key) => {
  const { title } = sitelinks[key]
  if (addUrl) {
    index[key] = { title, url: getSitelinkUrl(key, title) }
  } else {
    index[key] = title
  }
  return index
}

},{"./sitelinks_helpers":9}],7:[function(require,module,exports){
module.exports = function (input, options = {}) {
  if (typeof input === 'string') input = JSON.parse(input)

  const { vars } = input.head
  const results = input.results.bindings

  if (vars.length === 1 && options.minimize === true) {
    const varName = vars[0]
    return results
    .map(result => parseValue(result[varName]))
    // filtering-out bnodes
    .filter(result => result != null)
  }

  const { richVars, standaloneVars } = identifyVars(vars)
  return results.map(getSimplifiedResult(richVars, standaloneVars))
}

const parseValue = function (valueObj) {
  if (!(valueObj)) return
  var { datatype } = valueObj
  datatype = datatype && datatype.replace('http://www.w3.org/2001/XMLSchema#', '')
  const parser = parsers[valueObj.type] || getDatatypesParsers(datatype)
  return parser(valueObj)
}

const parsers = {
  uri: valueObj => parseUri(valueObj.value),
  // blank nodes will be filtered-out in order to get things simple
  bnode: () => null
}

const numberParser = valueObj => parseFloat(valueObj.value)

const getDatatypesParsers = function (datatype) {
  datatype = datatype && datatype.replace('http://www.w3.org/2001/XMLSchema#', '')
  return datatypesParsers[datatype] || passValue
}

const datatypesParsers = {
  decimal: numberParser,
  integer: numberParser,
  float: numberParser,
  double: numberParser,
  boolean: valueObj => valueObj.value === 'true'
}

// return the raw value if the datatype is missing
const passValue = valueObj => valueObj.value

const parseUri = function (uri) {
  if (uri.startsWith('http://www.wikidata.org/entity/statement/')) {
    return convertStatementUriToGuid(uri)
  }

  return uri
  .replace('http://www.wikidata.org/entity/', '')
  .replace('http://www.wikidata.org/prop/direct/', '')
}

const convertStatementUriToGuid = function (uri) {
  uri = uri.replace('http://www.wikidata.org/entity/statement/', '')
  const parts = uri.split('-')
  return parts[0] + '$' + parts.slice(1).join('-')
}

const identifyVars = function (vars) {
  const data = { richVars: [], standaloneVars: [] }
  return vars.reduce(spreadVars(vars), data)
}

const spreadVars = vars => (data, varName) => {
  if (vars.some(isAssociatedVar(varName))) {
    data.richVars.push(varName)
    return data
  }

  if (!associatedVarPattern.test(varName)) {
    data.standaloneVars.push(varName)
    return data
  }

  let associatedVar = varName
    .replace(associatedVarPattern, '$1')
    // The pattern regex fails to capture AltLabel prefixes alone,
    // due to the comflict with Label
    .replace(/Alt$/, '')

  if (!vars.includes(associatedVar)) {
    data.standaloneVars.push(varName)
  }

  return data
}

const associatedVarPattern = /^(\w+)(Label|Description|AltLabel)$/

const isAssociatedVar = varNameA => varNameB => {
  if (`${varNameA}Label` === varNameB) return true
  if (`${varNameA}Description` === varNameB) return true
  if (`${varNameA}AltLabel` === varNameB) return true
  return false
}

const getSimplifiedResult = function (richVars, standaloneVars) {
  return function (result) {
    const simplifiedResult = {}
    for (let varName of richVars) {
      let value = parseValue(result[varName])
      if (value != null) {
        simplifiedResult[varName] = { value }
        addAssociatedValue(result, varName, 'label', simplifiedResult[varName])
        addAssociatedValue(result, varName, 'description', simplifiedResult[varName])
        addAssociatedValue(result, varName, 'aliases', simplifiedResult[varName])
      }
    }
    for (let varName of standaloneVars) {
      simplifiedResult[varName] = parseValue(result[varName])
    }
    return simplifiedResult
  }
}

const addAssociatedValue = (result, varName, associatedVarName, varData) => {
  const fullAssociatedVarName = varName + varNameSuffixMap[associatedVarName]
  const fullAssociatedVarData = result[fullAssociatedVarName]
  if (fullAssociatedVarData != null) {
    varData[associatedVarName] = fullAssociatedVarData.value
  }
}

const varNameSuffixMap = {
  label: 'Label',
  description: 'Description',
  aliases: 'AltLabel'
}

},{}],8:[function(require,module,exports){
const simplifyTextAttributes = multivalue => data => {
  return Object.keys(data).reduce(aggregateValues(data, multivalue), {})
}

const aggregateValues = (data, multivalue) => (index, lang) => {
  const obj = data[lang]
  index[lang] = multivalue ? obj.map(getValue) : obj.value
  return index
}

const getValue = obj => obj.value

const singleValue = simplifyTextAttributes(false)

module.exports = {
  labels: singleValue,
  descriptions: singleValue,
  aliases: simplifyTextAttributes(true)
}

},{}],9:[function(require,module,exports){
const { fixedEncodeURIComponent, replaceSpaceByUnderscores, isPlainObject } = require('../utils/utils')
const { isPropertyId } = require('./helpers')
const wikidataBase = 'https://www.wikidata.org/wiki/'
const languages = require('./sitelinks_languages')

const getSitelinkUrl = (site, title) => {
  if (isPlainObject(site)) {
    title = site.title
    site = site.site
  }

  if (!site) throw new Error('missing a site')
  if (!title) throw new Error('missing a title')

  const shortSiteKey = site.replace(/wiki$/, '')
  const specialUrlBuilder = siteUrlBuilders[shortSiteKey] || siteUrlBuilders[site]
  if (specialUrlBuilder) return specialUrlBuilder(title)

  const { lang, project } = getSitelinkData(site)
  title = fixedEncodeURIComponent(replaceSpaceByUnderscores(title))
  return `https://${lang}.${project}.org/wiki/${title}`
}

const wikimediaSite = subdomain => title => `https://${subdomain}.wikimedia.org/wiki/${title}`

const siteUrlBuilders = {
  commons: wikimediaSite('commons'),
  mediawiki: title => `https://www.mediawiki.org/wiki/${title}`,
  meta: wikimediaSite('meta'),
  species: wikimediaSite('species'),
  wikidata: title => {
    if (isPropertyId(title)) return `${wikidataBase}Property:${title}`
    return `${wikidataBase}${title}`
  }
}

const getSitelinkData = site => {
  const specialProjectName = specialSites[site]
  if (specialProjectName) return { lang: 'en', project: specialProjectName }

  const [ lang, projectSuffix, rest ] = site.split('wik')

  // Detecting cases like 'frwikiwiki' that would return [ 'fr', 'i', 'i' ]
  if (rest != null) throw new Error(`invalid sitelink: ${site}`)

  if (languages.indexOf(lang) === -1) {
    throw new Error(`sitelink lang not found: ${lang}`)
  }

  const project = projectsBySuffix[projectSuffix]
  if (!project) throw new Error(`sitelink project not found: ${project}`)

  return { lang, project }
}

const specialSites = {
  commonswiki: 'commons',
  mediawikiwiki: 'mediawiki',
  metawiki: 'meta',
  specieswiki: 'specieswiki',
  wikidatawiki: 'wikidata'
}

const isSitelinkKey = site => {
  try {
    // relies on getSitelinkData validation
    getSitelinkData(site)
    return true
  } catch (err) {
    return false
  }
}

const projectsBySuffix = {
  i: 'wikipedia',
  isource: 'wikisource',
  iquote: 'wikiquote',
  tionary: 'wiktionary',
  ibooks: 'wikibooks',
  iversity: 'wikiversity',
  ivoyage: 'wikivoyage',
  inews: 'wikinews'
}

module.exports = { getSitelinkUrl, getSitelinkData, isSitelinkKey }

},{"../utils/utils":22,"./helpers":1,"./sitelinks_languages":10}],10:[function(require,module,exports){
// Generated by 'npm run update-sitelinks-languages'
module.exports = ['aa', 'ab', 'af', 'ak', 'als', 'am', 'ang', 'an', 'ar', 'ast', 'as', 'av', 'ay', 'az', 'ba', 'be', 'bg', 'bh', 'bi', 'bm', 'bn', 'bo', 'br', 'bs', 'ca', 'chr', 'ch', 'co', 'cr', 'csb', 'cs', 'cv', 'cy', 'da', 'de', 'dv', 'dz', 'el', 'en', 'eo', 'es', 'et', 'eu', 'fa', 'fi', 'fj', 'fo', 'fr', 'fy', 'ga', 'gd', 'gl', 'gn', 'got', 'gu', 'gv', 'ha', 'he', 'hif', 'hi', 'hr', 'hsb', 'ht', 'hu', 'hy', 'ia', 'id', 'ie', 'ik', 'io', 'is', 'it', 'iu', 'ja', 'jbo', 'jv', 'ka', 'kk', 'kl', 'km', 'kn', 'ko', 'kr', 'ks', 'ku', 'kw', 'ky', 'la', 'lb', 'li', 'ln', 'lo', 'lt', 'lv', 'mg', 'mh', 'mi', 'mk', 'ml', 'mn', 'mo', 'mr', 'ms', 'mt', 'my', 'nah', 'na', 'nds', 'ne', 'nl', 'nn', 'no', 'oc', 'om', 'or', 'pa', 'pi', 'pl', 'pms', 'pnb', 'ps', 'pt', 'qu', 'rm', 'rn', 'roa_rup', 'ro', 'ru', 'rw', 'sah', 'sa', 'scn', 'sc', 'sd', 'se', 'sg', 'sh', 'simple', 'si', 'sk', 'sl', 'sm', 'sn', 'so', 'sq', 'sr', 'ss', 'st', 'su', 'sv', 'sw', 'ta', 'te', 'tg', 'th', 'ti', 'tk', 'tl', 'tn', 'to', 'tpi', 'tr', 'ts', 'tt', 'tw', 'ug', 'uk', 'ur', 'uz', 'vec', 'vi', 'vo', 'wa', 'wo', 'xh', 'yi', 'yo', 'yue', 'za', 'zh_min_nan', 'zh', 'zu', 'ace', 'arc', 'arz', 'bar', 'bat_smg', 'bcl', 'be_x_old', 'bjn', 'bpy', 'bug', 'bxr', 'cbk_zam', 'cdo', 'ce', 'ceb', 'cho', 'chy', 'ckb', 'crh', 'cu', 'diq', 'dsb', 'ee', 'eml', 'ext', 'ff', 'fiu_vro', 'frp', 'frr', 'fur', 'gag', 'gan', 'glk', 'hak', 'haw', 'ho', 'hz', 'ig', 'ii', 'ilo', 'kaa', 'kab', 'kbd', 'kg', 'ki', 'kj', 'koi', 'krc', 'ksh', 'kv', 'lad', 'lbe', 'lez', 'lg', 'lij', 'lmo', 'ltg', 'mai', 'map_bms', 'mdf', 'mhr', 'min', 'mrj', 'mus', 'mwl', 'myv', 'mzn', 'nap', 'nds_nl', 'new', 'ng', 'nov', 'nrm', 'nso', 'nv', 'ny', 'os', 'pag', 'pam', 'pap', 'pcd', 'pdc', 'pfl', 'pih', 'pnt', 'rmy', 'roa_tara', 'rue', 'sco', 'srn', 'stq', 'szl', 'tet', 'tum', 'ty', 'tyv', 'udm', 've', 'vep', 'vls', 'war', 'wuu', 'xal', 'xmf', 'zea', 'zh_classical', 'zh_yue', 'lrc', 'gom', 'azb', 'ady', 'jam', 'tcy', 'olo', 'dty', 'atj', 'kbp', 'din', 'gor', 'inh', 'lfn', 'sat', 'shn']

},{}],11:[function(require,module,exports){
module.exports = function (wikidataTime) {
  // Also accept claim datavalue.value objects
  if (typeof wikidataTime === 'object') {
    wikidataTime = wikidataTime.time
  }

  const sign = wikidataTime[0]
  var [ yearMonthDay, withinDay ] = wikidataTime.slice(1).split('T')

  // Wikidata generates invalid ISO dates to indicate precision
  // ex: +1990-00-00T00:00:00Z to indicate 1990 with year precision
  yearMonthDay = yearMonthDay.replace(/-00/g, '-01')
  const rest = `${yearMonthDay}T${withinDay}`

  return fullDateData(sign, rest)
}

const fullDateData = function (sign, rest) {
  const year = rest.split('-')[0]
  const needsExpandedYear = sign === '-' || year.length > 4

  return needsExpandedYear ? expandedYearDate(sign, rest, year) : new Date(rest)
}

const expandedYearDate = function (sign, rest, year) {
  var date
  // Using ISO8601 expanded notation for negative years or positive
  // years with more than 4 digits: adding up to 2 leading zeros
  // when needed. Can't find the documentation again, but testing
  // with `new Date(date)` gives a good clue of the implementation
  if (year.length === 4) {
    date = `${sign}00${rest}`
  } else if (year.length === 5) {
    date = `${sign}0${rest}`
  } else {
    date = sign + rest
  }
  return new Date(date)
}

},{}],12:[function(require,module,exports){
const wdk = module.exports = {}

wdk.searchEntities = require('./queries/search_entities')
wdk.getEntities = require('./queries/get_entities')
wdk.getManyEntities = require('./queries/get_many_entities')
wdk.sparqlQuery = require('./queries/sparql_query')
wdk.getReverseClaims = require('./queries/get_reverse_claims')
wdk.getRevisions = require('./queries/get_revisions')
wdk.getEntitiesFromSitelinks = require('./queries/get_entities_from_sitelinks')
// Legacy
wdk.getWikidataIdsFromSitelinks = wdk.getEntitiesFromSitelinks

wdk.parse = require('./helpers/parse_responses')

const claimsSimplifiers = require('./helpers/simplify_claims')
const simplifySparqlResults = require('./helpers/simplify_sparql_results')

wdk.simplify = require('../lib/helpers/simplify_text_attributes')
const { simplifyEntity, simplifyEntities } = require('../lib/helpers/simplify_entity')
wdk.simplify.entity = simplifyEntity
wdk.simplify.entities = simplifyEntities

wdk.simplify.claim = claimsSimplifiers.simplifyClaim
wdk.simplify.propertyClaims = claimsSimplifiers.simplifyPropertyClaims
wdk.simplify.claims = claimsSimplifiers.simplifyClaims
wdk.simplify.qualifier = claimsSimplifiers.simplifyQualifier
wdk.simplify.propertyQualifiers = claimsSimplifiers.simplifyPropertyQualifiers
wdk.simplify.qualifiers = claimsSimplifiers.simplifyQualifiers

wdk.simplify.sitelinks = require('../lib/helpers/simplify_sitelinks')
wdk.simplify.sparqlResults = simplifySparqlResults

// Legacy
wdk.simplifySparqlResults = require('./helpers/simplify_sparql_results')
// Legacy + truthyClaims + truthyPropertyClaims
Object.assign(wdk, claimsSimplifiers)

// Aliases
wdk.getWikidataIdsFromWikipediaTitles = wdk.getWikidataIdsFromSitelinks

const helpers = require('../lib/helpers/helpers')
const sitelinksHelpers = require('../lib/helpers/sitelinks_helpers')
Object.assign(wdk, helpers, sitelinksHelpers)

},{"../lib/helpers/helpers":1,"../lib/helpers/simplify_entity":5,"../lib/helpers/simplify_sitelinks":6,"../lib/helpers/simplify_text_attributes":8,"../lib/helpers/sitelinks_helpers":9,"./helpers/parse_responses":3,"./helpers/simplify_claims":4,"./helpers/simplify_sparql_results":7,"./queries/get_entities":13,"./queries/get_entities_from_sitelinks":14,"./queries/get_many_entities":15,"./queries/get_reverse_claims":16,"./queries/get_revisions":17,"./queries/search_entities":18,"./queries/sparql_query":19}],13:[function(require,module,exports){
const buildUrl = require('../utils/build_url')
const { isPlainObject, forceArray, shortLang } = require('../utils/utils')

module.exports = function (ids, languages, props, format, redirects) {
  // Polymorphism: arguments can be passed as an object keys
  if (isPlainObject(ids)) {
    ({ ids, languages, props, format, redirects } = ids)
  }

  format = format || 'json'

  // ids can't be let empty
  if (!(ids && ids.length > 0)) throw new Error('no id provided')

  // Allow to pass ids as a single string
  ids = forceArray(ids)

  if (ids.length > 50) {
    console.warn(`getEntities accepts 50 ids max to match Wikidata API limitations:
      this request won't get all the desired entities.
      You can use getManyEntities instead to generate several request urls
      to work around this limitation`)
  }

  // Properties can be either one property as a string
  // or an array or properties;
  // either case me just want to deal with arrays

  const query = {
    action: 'wbgetentities',
    ids: ids.join('|'),
    format
  }

  if (redirects === false) query.redirects = 'no'

  if (languages) {
    languages = forceArray(languages).map(shortLang)
    query.languages = languages.join('|')
  }

  if (props && props.length > 0) query.props = forceArray(props).join('|')

  return buildUrl(query)
}

},{"../utils/build_url":20,"../utils/utils":22}],14:[function(require,module,exports){
const buildUrl = require('../utils/build_url')
const { isPlainObject, forceArray, shortLang } = require('../utils/utils')

module.exports = function (titles, sites, languages, props, format, redirects) {
  // polymorphism: arguments can be passed as an object keys
  if (isPlainObject(titles)) {
    // Not using destructuring assigment there as it messes with both babel and standard
    const params = titles
    titles = params.titles
    sites = params.sites
    languages = params.languages
    props = params.props
    format = params.format
    redirects = params.redirects
  }

  format = format || 'json'

  // titles cant be let empty
  if (!(titles && titles.length > 0)) throw new Error('no title provided')
  // default to the English Wikipedia
  if (!(sites && sites.length > 0)) sites = [ 'enwiki' ]

  // Properties can be either one property as a string
  // or an array or properties;
  // either case me just want to deal with arrays
  titles = forceArray(titles)
  sites = forceArray(sites).map(parseSite)
  props = forceArray(props)

  const query = {
    action: 'wbgetentities',
    titles: titles.join('|'),
    sites: sites.join('|'),
    format: format
  }

  // Normalizing only works if there is only one site and title
  if (sites.length === 1 && titles.length === 1) {
    query.normalize = true
  }

  if (languages) {
    languages = forceArray(languages).map(shortLang)
    query.languages = languages.join('|')
  }

  if (props && props.length > 0) query.props = props.join('|')

  if (redirects === false) query.redirects = 'no'

  return buildUrl(query)
}

// convert 2 letters language code to Wikipedia sitelinks code
const parseSite = site => site.length === 2 ? `${site}wiki` : site

},{"../utils/build_url":20,"../utils/utils":22}],15:[function(require,module,exports){
const getEntities = require('./get_entities')
const { isPlainObject } = require('../utils/utils')

module.exports = function (ids, languages, props, format, redirects) {
  // Polymorphism: arguments can be passed as an object keys
  if (isPlainObject(ids)) {
    ({ ids, languages, props, format, redirects } = ids)
  }

  if (!(ids instanceof Array)) throw new Error('getManyEntities expects an array of ids')

  return getIdsGroups(ids)
  .map(idsGroup => getEntities(idsGroup, languages, props, format, redirects))
}

const getIdsGroups = function (ids) {
  const groups = []
  while (ids.length > 0) {
    let group = ids.slice(0, 50)
    ids = ids.slice(50)
    groups.push(group)
  }
  return groups
}

},{"../utils/utils":22,"./get_entities":13}],16:[function(require,module,exports){
const helpers = require('../helpers/helpers')
const sparqlQuery = require('./sparql_query')
// Fiter-out properties. Can't be filtered by
// `?subject a wikibase:Item`, as those triples are omitted
// https://www.mediawiki.org/wiki/Wikibase/Indexing/RDF_Dump_Format#WDQS_data_differences
const itemsOnly = 'FILTER NOT EXISTS { ?subject rdf:type wikibase:Property . } '

module.exports = function (property, value, options = {}) {
  var { limit, caseInsensitive, keepProperties } = options
  const valueFn = caseInsensitive ? caseInsensitiveValueQuery : directValueQuery
  const filter = keepProperties ? '' : itemsOnly

  // Allow to request values for several properties at once
  if (property instanceof Array) {
    property = property.map(prefixifyProperty).join('|')
  } else {
    property = prefixifyProperty(property)
  }

  const valueBlock = getValueBlock(value, valueFn, property, filter)
  var sparql = `SELECT DISTINCT ?subject WHERE { ${valueBlock} }`
  if (limit) sparql += ` LIMIT ${limit}`
  return sparqlQuery(sparql)
}

function getValueBlock (value, valueFn, property, filter) {
  if (!(value instanceof Array)) {
    return valueFn(property, getValueString(value), filter)
  }

  const valuesBlocks = value
    .map(getValueString)
    .map(valStr => valueFn(property, valStr, filter))

  return '{ ' + valuesBlocks.join('} UNION {') + ' }'
}

function getValueString (value) {
  if (helpers.isItemId(value)) {
    value = `wd:${value}`
  } else if (typeof value === 'string') {
    value = `'${value}'`
  }
  return value
}

function directValueQuery (property, value, filter, limit) {
  return `?subject ${property} ${value} .
    ${filter}`
}

// Discussion on how to make this query optimal:
// http://stackoverflow.com/q/43073266/3324977
function caseInsensitiveValueQuery (property, value, filter, limit) {
  return `?subject ${property} ?value .
    FILTER (lcase(?value) = ${value.toLowerCase()})
    ${filter}`
}

const prefixifyProperty = property => 'wdt:' + property

},{"../helpers/helpers":1,"./sparql_query":19}],17:[function(require,module,exports){
const buildUrl = require('../utils/build_url')
const { forceArray } = require('../utils/utils')

module.exports = function (ids, options = {}) {
  ids = forceArray(ids)
  const uniqueId = ids.length === 1
  const query = {
    action: 'query',
    prop: 'revisions'
  }
  query.titles = ids.join('|')
  query.format = options.format || 'json'
  if (uniqueId) query.rvlimit = options.limit || 'max'
  if (uniqueId && options.start) query.rvstart = getEpochSeconds(options.start)
  if (uniqueId && options.end) query.rvend = getEpochSeconds(options.end)
  return buildUrl(query)
}

const getEpochSeconds = function (date) {
  // Return already formatted epoch seconds:
  // if a date in milliseconds appear to be earlier than 2000-01-01, that's probably
  // already seconds actually
  if (typeof date === 'number' && date < earliestPointInMs) return date
  return Math.trunc(new Date(date).getTime() / 1000)
}

const earliestPointInMs = new Date('2000-01-01').getTime()

},{"../utils/build_url":20,"../utils/utils":22}],18:[function(require,module,exports){
const buildUrl = require('../utils/build_url')
const { isPlainObject } = require('../utils/utils')
const types = [ 'item', 'property', 'lexeme', 'form', 'sense' ]

module.exports = function (search, language, limit, format, uselang) {
  // Using the variable 'offset' instead of 'continue' as the later is a reserved word
  var type, offset

  // polymorphism: arguments can be passed as an object keys
  if (isPlainObject(search)) {
    // Not using destructuring assigment there as it messes with both babel and standard
    const params = search
    search = params.search
    language = params.language
    limit = params.limit
    offset = params.continue
    format = params.format
    uselang = params.uselang
    type = params.type
  }

  if (!(search && search.length > 0)) throw new Error("search can't be empty")

  language = language || 'en'
  uselang = uselang || language
  limit = limit || '20'
  format = format || 'json'
  type = type || 'item'

  if (!types.includes(type)) throw new Error(`invalid type: ${type}`)

  return buildUrl({
    action: 'wbsearchentities',
    search,
    language,
    limit,
    continue: offset,
    format,
    uselang,
    type
  })
}

},{"../utils/build_url":20,"../utils/utils":22}],19:[function(require,module,exports){
const { fixedEncodeURIComponent } = require('../utils/utils')

module.exports = function (sparql) {
  const query = fixedEncodeURIComponent(sparql)
  return `https://query.wikidata.org/sparql?format=json&query=${query}`
}

},{"../utils/utils":22}],20:[function(require,module,exports){
const wikidataApiRoot = 'https://www.wikidata.org/w/api.php'
const isBrowser = typeof location !== 'undefined' && typeof document !== 'undefined'
const qs = isBrowser ? require('./querystring_lite') : require('querystring')

module.exports = function (queryObj) {
  // Request CORS headers if the request is made from a browser
  // See https://www.wikidata.org/w/api.php ('origin' parameter)
  if (isBrowser) queryObj.origin = '*'
  return wikidataApiRoot + '?' + qs.stringify(queryObj)
}

},{"./querystring_lite":21,"querystring":27}],21:[function(require,module,exports){
module.exports = {
  stringify: function (queryObj) {
    var qstring = ''
    for (let key in queryObj) {
      let value = queryObj[key]
      if (value) qstring += `&${key}=${value}`
    }

    qstring = qstring.slice(1)

    // encodeURI should be accessible in a browser environment
    // otherwise if neither node.js querystring nor encodeURI
    // are accessible, just return the string
    if (encodeURI) return encodeURI(qstring)
    return qstring
  }
}

},{}],22:[function(require,module,exports){
module.exports = {
  // Ex: keep only 'fr' in 'fr_FR'
  shortLang: language => language.toLowerCase().split(/[^a-z]/)[0],

  // a polymorphism helper:
  // accept either a string or an array and return an array
  forceArray: function (array) {
    if (typeof array === 'string') array = [ array ]
    return array || []
  },

  // simplistic implementation to filter-out arrays
  isPlainObject: function (obj) {
    if (!obj || typeof obj !== 'object' || obj instanceof Array) return false
    return true
  },

  // encodeURIComponent ignores !, ', (, ), and *
  // cf https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/encodeURIComponent#Description
  fixedEncodeURIComponent: function (str) {
    return encodeURIComponent(str).replace(/[!'()*]/g, encodeCharacter)
  },

  replaceSpaceByUnderscores: str => str.replace(/\s/g, '_'),

  uniq: array => Array.from(new Set(array))
}

const encodeCharacter = char => '%' + char.charCodeAt(0).toString(16)

},{}],23:[function(require,module,exports){
const wbk = require('wikidata-sdk');
const fetch = require('node-fetch');

window.wbk = wbk;

exports.wikidataApi = function(para, callback) {

    if(para.ids.length === 0){
        callback(null,null);
        return;
    }
    const urls = wbk.getManyEntities({
        ids: para.ids,
        languages: para.lang || [ 'en', 'fr', 'de' ], // returns all languages if not specified
        props: para.props || [ 'labels', 'descriptions', 'claims', 'sitelinks/urls' ], // returns all data if not specified
        // format: 'xml', // defaults to json
        // redirections: false // defaults to true
    });
    // console.log(urls);
    if(urls.length === 1){
        fetch(urls)
        // .then(response => console.log(response))
            .then(response => response.json())
            // .then(wbk.parse.wd.entities)
            .then(entities => {
                // console.log(entities);
                callback(null,entities);
                // return entities;
            }).catch(error =>{ console.log("ERROR fetch in Wikidata.js :"+error.message); callback(new Error("ERROR fetch in Wikidata.js :"+error.message),null); }); //add Error catch
        //https://nodejs.org/api/errors.html#errors_error_first_callbacks
    }else{
        //https://stackoverflow.com/questions/31710768/how-can-i-fetch-an-array-of-urls-with-promise-all
        //map all requests and emerge the entities
        Promise.all(urls.map(u=>fetch(u))).then(responses =>
            Promise.all(responses.map(res => res.json()))
        ).then(texts => {
            var entities = {};
            for(var text in texts){
                for(var index in texts[text].entities){
                    entities[index] = texts[text].entities[index];
                }
            }
            callback(null,{entities: entities});

        }).catch(error => {console.log("Error Promise in wikidata.js : "+error.message); callback(new Error("Error Promise in wikidata.js : "+error.message),null);}); //add Error catch
    }

};
},{"node-fetch":24,"wikidata-sdk":12}],24:[function(require,module,exports){
(function (global){
"use strict";

// ref: https://github.com/tc39/proposal-global
var getGlobal = function () {
	// the only reliable means to get the global object is
	// `Function('return this')()`
	// However, this causes CSP violations in Chrome apps.
	if (typeof self !== 'undefined') { return self; }
	if (typeof window !== 'undefined') { return window; }
	if (typeof global !== 'undefined') { return global; }
	throw new Error('unable to locate global object');
}

var global = getGlobal();

module.exports = exports = global.fetch;

// Needed for TypeScript and Webpack.
exports.default = global.fetch.bind(global);

exports.Headers = global.Headers;
exports.Request = global.Request;
exports.Response = global.Response;
}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{}],25:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

'use strict';

// If obj.hasOwnProperty has been overridden, then calling
// obj.hasOwnProperty(prop) will break.
// See: https://github.com/joyent/node/issues/1707
function hasOwnProperty(obj, prop) {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

module.exports = function(qs, sep, eq, options) {
  sep = sep || '&';
  eq = eq || '=';
  var obj = {};

  if (typeof qs !== 'string' || qs.length === 0) {
    return obj;
  }

  var regexp = /\+/g;
  qs = qs.split(sep);

  var maxKeys = 1000;
  if (options && typeof options.maxKeys === 'number') {
    maxKeys = options.maxKeys;
  }

  var len = qs.length;
  // maxKeys <= 0 means that we should not limit keys count
  if (maxKeys > 0 && len > maxKeys) {
    len = maxKeys;
  }

  for (var i = 0; i < len; ++i) {
    var x = qs[i].replace(regexp, '%20'),
        idx = x.indexOf(eq),
        kstr, vstr, k, v;

    if (idx >= 0) {
      kstr = x.substr(0, idx);
      vstr = x.substr(idx + 1);
    } else {
      kstr = x;
      vstr = '';
    }

    k = decodeURIComponent(kstr);
    v = decodeURIComponent(vstr);

    if (!hasOwnProperty(obj, k)) {
      obj[k] = v;
    } else if (isArray(obj[k])) {
      obj[k].push(v);
    } else {
      obj[k] = [obj[k], v];
    }
  }

  return obj;
};

var isArray = Array.isArray || function (xs) {
  return Object.prototype.toString.call(xs) === '[object Array]';
};

},{}],26:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

'use strict';

var stringifyPrimitive = function(v) {
  switch (typeof v) {
    case 'string':
      return v;

    case 'boolean':
      return v ? 'true' : 'false';

    case 'number':
      return isFinite(v) ? v : '';

    default:
      return '';
  }
};

module.exports = function(obj, sep, eq, name) {
  sep = sep || '&';
  eq = eq || '=';
  if (obj === null) {
    obj = undefined;
  }

  if (typeof obj === 'object') {
    return map(objectKeys(obj), function(k) {
      var ks = encodeURIComponent(stringifyPrimitive(k)) + eq;
      if (isArray(obj[k])) {
        return map(obj[k], function(v) {
          return ks + encodeURIComponent(stringifyPrimitive(v));
        }).join(sep);
      } else {
        return ks + encodeURIComponent(stringifyPrimitive(obj[k]));
      }
    }).join(sep);

  }

  if (!name) return '';
  return encodeURIComponent(stringifyPrimitive(name)) + eq +
         encodeURIComponent(stringifyPrimitive(obj));
};

var isArray = Array.isArray || function (xs) {
  return Object.prototype.toString.call(xs) === '[object Array]';
};

function map (xs, f) {
  if (xs.map) return xs.map(f);
  var res = [];
  for (var i = 0; i < xs.length; i++) {
    res.push(f(xs[i], i));
  }
  return res;
}

var objectKeys = Object.keys || function (obj) {
  var res = [];
  for (var key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) res.push(key);
  }
  return res;
};

},{}],27:[function(require,module,exports){
'use strict';

exports.decode = exports.parse = require('./decode');
exports.encode = exports.stringify = require('./encode');

},{"./decode":25,"./encode":26}]},{},[23]);
