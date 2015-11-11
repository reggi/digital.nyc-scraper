import 'babel-polyfill'
import path from 'path'
import crypto from 'crypto'
import request from 'request-promise'
import cheerio from 'cheerio'
import Promise from 'bluebird'
import redis from 'redis'
import PouchDB from 'pouchdb'
import csv from 'csv'
import fs from 'fs'
import { range, clone, merge } from 'lodash'
Promise.promisifyAll(redis.RedisClient.prototype)
Promise.promisifyAll(redis.Multi.prototype)
Promise.promisifyAll(csv)
Promise.promisifyAll(fs)

// (pouch's design doc)
/* global emit */

const POUCH_URI = 'http://127.0.0.1:5984/companies'
const DIGITAL_NYC_URI = 'http://www.digital.nyc'

let pouchClient = new PouchDB(POUCH_URI)
let redisClient = redis.createClient()
let getStartURI = () => `${DIGITAL_NYC_URI}/startups`
let getProfileURI = (profile) => `${DIGITAL_NYC_URI}${profile}`
let getPageURI = (page) => `${DIGITAL_NYC_URI}/startups?page=${page}`
let createHash = (text) => crypto.createHash('md5').update(text).digest('hex')
let numberOfPages = (numberOfCompanies) => Math.floor(numberOfCompanies / 20)

let debounceRequest = promiseDebounce(request.get, 1000, 75).bind(request)
let debouncePut = promiseDebounce(pouchClient.put, 1000, 100).bind(pouchClient)

function updateDoc (doc, add) {
  let _doc = clone(doc)
  delete _doc._rev
  delete _doc._id
  return merge(_doc, add)
}

function putWrapper (row, add) {
  let update = updateDoc(row.doc, add)
  return debouncePut(update, row.doc._id, row.doc._rev)
}

/* cached requests */
async function cacheRequest (options) {
  let HTML
  let stringOptions = JSON.stringify(options)
  let optionsHashed = createHash(stringOptions)
  let get = await redisClient.getAsync(optionsHashed)
  if (get) return get
  try {
    HTML = await debounceRequest(options)
  } catch (e) {
    HTML = false
  }
  console.log(`incoming: ${options}`)
  console.log(`hashed: ${optionsHashed}`)
  console.log(`exists: ${Boolean(get)}`)
  console.log(`HTML: ${Boolean(HTML)}`)
  await redisClient.setAsync(optionsHashed, HTML)
  return HTML
}

/* fetch number of companies */
async function numberOfCompanies () {
  let startURI = getStartURI()
  let startHTML = await cacheRequest(startURI)
  let $ = cheerio.load(startHTML)
  let summary = $('.result-summary').text()
  let match = summary.match(/Showing 1 - 20 of (\d+) Startups/)
  if (!match) throw new Error('no number of companies found')
  return parseInt(match[1], 10)
}

function getCompaniesOnPage (pageHTML) {
  let $ = cheerio.load(pageHTML)
  let companySelector = 'h3.node-title a'
  let companies = $(companySelector).map(function (i, el) {
    let name = $(this).text()
    let profile = $(this).attr('href')
    return {
      '_id': createHash(name),
      'name': name,
      'profile': profile
    }
  }).get()
  return companies
}

async function insertCompaniesOnPage (page) {
  let pageURI = getPageURI(page)
  let pageHTML = await cacheRequest(pageURI)
  let pageCompanies = getCompaniesOnPage(pageHTML)
  await pouchClient.bulkDocs(pageCompanies)
  return pageCompanies
}
/* scan pages (get name, profile)*/
function scanPages (numberOfPages) {
  // array of pages
  let pages = range(1, numberOfPages)
  return Promise.map(pages, page => insertCompaniesOnPage(page))
}

function getCompanyWebsite (profileHTML) {
  let $ = cheerio.load(profileHTML)
  let websiteSelector = 'span.field-label:contains(Website: )'
  let website = $(websiteSelector).next().attr('href')
  if (website) return website
  return null
}

async function insertCompanyWebsite (company) {
  if (typeof company.doc.website !== 'undefined') return company.doc.website
  if (!company.doc.profile) throw new Error('missing company profile')
  let profileURI = getProfileURI(company.doc.profile)
  let profileHTML = await cacheRequest(profileURI)
  let website = getCompanyWebsite(profileHTML)
  console.log('name:', company.doc.name)
  console.log('website:', website)
  return await putWrapper(company, { website })
}

function promiseDebounce (fn, delay, count) {
  var working = 0
  var queue = []
  function work () {
    if ((queue.length === 0) || (working === count)) return
    working++
    Promise.delay(delay).tap(function () { working-- }).then(work)
    var next = queue.shift()
    next[2](fn.apply(next[0], next[1]))
  }
  return function debounced () {
    var args = arguments
    return new Promise(function (resolve) {
      queue.push([this, args, resolve])
      if (working < count) work()
    }.bind(this))
  }
}

function getUsesShopify (websiteHTML) {
  if (!websiteHTML) return null
  let match = websiteHTML.match(/shopify/gi)
  return Boolean(match)
}

async function insertUsesShopify (company) {
  if (typeof company.doc.usesShopify !== 'undefined') {
    console.log('name:', company.doc.name)
    console.log('usesShopify:', `already set to ${company.doc.usesShopify}`)
    return company.doc.usesShopify
  }
  if (!company.doc.website) {
    console.log('name:', company.doc.name)
    console.log('usesShopify:', 'no website avilable')
    await putWrapper(company, { usesShopify: null })
    return null
  }
  let websiteHTML = await cacheRequest(company.doc.website)
  if (websiteHTML === null) {
    console.log('name:', company.doc.name)
    console.log('usesShopify:', 'website html is null')
    await putWrapper(company, { usesShopify: null })
    return null
  }
  let usesShopify = getUsesShopify(websiteHTML)
  console.log('name:', company.doc.name)
  console.log('usesShopify:', `new entry ${usesShopify}`)
  await putWrapper(company, { usesShopify })
  return usesShopify
}

/* scan profiles (get website) */
async function scanProfiles () {
  let companies = await pouchClient.allDocs({
    include_docs: true
  })
  // let use = slice(companies.rows, 100, 200)
  let use = companies.rows
  return Promise.map(use, company => insertCompanyWebsite(company))
}

/* scan websites (get shopify) */
async function scanWebsites () {
  let companies = await pouchClient.allDocs({
    include_docs: true
  })
  // let use = slice(companies.rows, 0, 300)
  let use = companies.rows
  return Promise.map(use, company => insertUsesShopify(company))
}

async function ensureDesign (doc) {
  let exists = await pouchClient.get(doc._id)
  if (exists) return exists
  await pouchClient.put(doc)
  return await pouchClient.get(doc.id)
}

const shopifyDesignDoc = {
  '_id': '_design/shopify',
  'language': 'javascript',
  'views': {
    'shopify': {
      'map': function (doc) {
        if (doc.usesShopify === true) {
          emit(null, doc.website)
        }
      }.toString()
    }
  }
}

async function createCsv () {
  let _companies = await pouchClient.allDocs({
    include_docs: true
  })
  let companies = _companies.rows
  companies = companies.map(company => {
    return {
      name: company.doc.name,
      website: company.doc.website
    }
  })
  let companiesCSV = await csv.stringifyAsync(companies, {header: true})
  let filePath = path.join(__dirname, '..', 'data', 'nyc-companies.csv')
  await fs.writeFileAsync(filePath, companiesCSV)
  return companiesCSV
}

async function createShopifyCsv () {
  await ensureDesign(shopifyDesignDoc)
  let _shops = await pouchClient.query('shopify/shopify')
  let shops = _shops.rows
  shops = shops.map(shop => {
    return {
      'website': shop.value
    }
  })
  let shopsCSV = await csv.stringifyAsync(shops, {header: true})
  let filePath = path.join(__dirname, '..', 'data', 'nyc-shopify-companies.csv')
  await fs.writeFileAsync(filePath, shopsCSV)
  return shopsCSV
}

async function main () {
  let NOC = await numberOfCompanies()
  let NOP = numberOfPages(NOC)
  let count = await pouchClient.info()
  console.log('count', count)
  await scanPages(NOP)
  await scanProfiles()
  await scanWebsites()
  await createCsv()
  await createShopifyCsv()
  redisClient.quit()
}

export default main
