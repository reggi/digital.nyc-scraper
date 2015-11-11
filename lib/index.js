'use strict';

require('babel-polyfill');

var _path = require('path');

var _path2 = _interopRequireDefault(_path);

var _crypto = require('crypto');

var _crypto2 = _interopRequireDefault(_crypto);

var _requestPromise = require('request-promise');

var _requestPromise2 = _interopRequireDefault(_requestPromise);

var _cheerio = require('cheerio');

var _cheerio2 = _interopRequireDefault(_cheerio);

var _bluebird = require('bluebird');

var _bluebird2 = _interopRequireDefault(_bluebird);

var _redis = require('redis');

var _redis2 = _interopRequireDefault(_redis);

var _pouchdb = require('pouchdb');

var _pouchdb2 = _interopRequireDefault(_pouchdb);

var _csv = require('csv');

var _csv2 = _interopRequireDefault(_csv);

var _fs = require('fs');

var _fs2 = _interopRequireDefault(_fs);

var _lodash = require('lodash');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

_bluebird2.default.promisifyAll(_redis2.default.RedisClient.prototype);
_bluebird2.default.promisifyAll(_redis2.default.Multi.prototype);
_bluebird2.default.promisifyAll(_csv2.default);
_bluebird2.default.promisifyAll(_fs2.default);

var POUCH_URI = 'http://127.0.0.1:5984/companies';
var DIGITAL_NYC_URI = 'http://www.digital.nyc';

var pouchClient = new _pouchdb2.default(POUCH_URI);
var redisClient = _redis2.default.createClient();
var getStartURI = function getStartURI() {
  return DIGITAL_NYC_URI + '/startups';
};
var getProfileURI = function getProfileURI(profile) {
  return '' + DIGITAL_NYC_URI + profile;
};
var getPageURI = function getPageURI(page) {
  return DIGITAL_NYC_URI + '/startups?page=' + page;
};
var createHash = function createHash(text) {
  return _crypto2.default.createHash('md5').update(text).digest('hex');
};
var numberOfPages = function numberOfPages(numberOfCompanies) {
  return Math.floor(numberOfCompanies / 20);
};

var debounceRequest = promiseDebounce(_requestPromise2.default.get, 1000, 75).bind(_requestPromise2.default);
var debouncePut = promiseDebounce(pouchClient.put, 1000, 100).bind(pouchClient);

function updateDoc(doc, add) {
  var _doc = (0, _lodash.clone)(doc);
  delete _doc._rev;
  delete _doc._id;
  return (0, _lodash.merge)(_doc, add);
}

function putWrapper(row, add) {
  var update = updateDoc(row.doc, add);
  return debouncePut(update, row.doc._id, row.doc._rev);
}

/* cached requests */
function cacheRequest(options) {
  var HTML, stringOptions, optionsHashed, get;
  return regeneratorRuntime.async(function cacheRequest$(_context) {
    while (1) switch (_context.prev = _context.next) {
      case 0:
        HTML = undefined;
        stringOptions = JSON.stringify(options);
        optionsHashed = createHash(stringOptions);
        _context.next = 5;
        return regeneratorRuntime.awrap(redisClient.getAsync(optionsHashed));

      case 5:
        get = _context.sent;

        if (!get) {
          _context.next = 8;
          break;
        }

        return _context.abrupt('return', get);

      case 8:
        _context.prev = 8;
        _context.next = 11;
        return regeneratorRuntime.awrap(debounceRequest(options));

      case 11:
        HTML = _context.sent;
        _context.next = 17;
        break;

      case 14:
        _context.prev = 14;
        _context.t0 = _context['catch'](8);

        HTML = false;

      case 17:
        console.log('incoming: ' + options);
        console.log('hashed: ' + optionsHashed);
        console.log('exists: ' + Boolean(get));
        console.log('HTML: ' + Boolean(HTML));
        _context.next = 23;
        return regeneratorRuntime.awrap(redisClient.setAsync(optionsHashed, HTML));

      case 23:
        return _context.abrupt('return', HTML);

      case 24:
      case 'end':
        return _context.stop();
    }
  }, null, this, [[8, 14]]);
}

/* fetch number of companies */
function numberOfCompanies() {
  var startURI, startHTML, $, summary, match;
  return regeneratorRuntime.async(function numberOfCompanies$(_context2) {
    while (1) switch (_context2.prev = _context2.next) {
      case 0:
        startURI = getStartURI();
        _context2.next = 3;
        return regeneratorRuntime.awrap(cacheRequest(startURI));

      case 3:
        startHTML = _context2.sent;
        $ = _cheerio2.default.load(startHTML);
        summary = $('.result-summary').text();
        match = summary.match(/Showing 1 - 20 of (\d+) Startups/);

        if (match) {
          _context2.next = 9;
          break;
        }

        throw new Error('no number of companies found');

      case 9:
        return _context2.abrupt('return', parseInt(match[1], 10));

      case 10:
      case 'end':
        return _context2.stop();
    }
  }, null, this);
}

function getCompaniesOnPage(pageHTML) {
  var $ = _cheerio2.default.load(pageHTML);
  var companySelector = 'h3.node-title a';
  var companies = $(companySelector).map(function (i, el) {
    var name = $(this).text();
    var profile = $(this).attr('href');
    return {
      '_id': createHash(name),
      'name': name,
      'profile': profile
    };
  }).get();
  return companies;
}

function insertCompaniesOnPage(page) {
  var pageURI, pageHTML, pageCompanies, insert;
  return regeneratorRuntime.async(function insertCompaniesOnPage$(_context3) {
    while (1) switch (_context3.prev = _context3.next) {
      case 0:
        pageURI = getPageURI(page);
        _context3.next = 3;
        return regeneratorRuntime.awrap(cacheRequest(pageURI));

      case 3:
        pageHTML = _context3.sent;
        pageCompanies = getCompaniesOnPage(pageHTML);
        _context3.next = 7;
        return regeneratorRuntime.awrap(pouchClient.bulkDocs(pageCompanies));

      case 7:
        insert = _context3.sent;
        return _context3.abrupt('return', pageCompanies);

      case 9:
      case 'end':
        return _context3.stop();
    }
  }, null, this);
}
/* scan pages (get name, profile)*/
function scanPages(numberOfPages) {
  // array of pages
  var pages = (0, _lodash.range)(1, numberOfPages);
  return _bluebird2.default.map(pages, function (page) {
    return insertCompaniesOnPage(page);
  });
}

function getCompanyWebsite(profileHTML) {
  var $ = _cheerio2.default.load(profileHTML);
  var websiteSelector = 'span.field-label:contains(Website: )';
  var website = $(websiteSelector).next().attr('href');
  if (website) return website;
  return null;
}

function insertCompanyWebsite(company) {
  var profileURI, profileHTML, website;
  return regeneratorRuntime.async(function insertCompanyWebsite$(_context4) {
    while (1) switch (_context4.prev = _context4.next) {
      case 0:
        if (!(typeof company.doc.website !== 'undefined')) {
          _context4.next = 2;
          break;
        }

        return _context4.abrupt('return', company.doc.website);

      case 2:
        if (company.doc.profile) {
          _context4.next = 4;
          break;
        }

        throw new Error('missing company profile');

      case 4:
        profileURI = getProfileURI(company.doc.profile);
        _context4.next = 7;
        return regeneratorRuntime.awrap(cacheRequest(profileURI));

      case 7:
        profileHTML = _context4.sent;
        website = getCompanyWebsite(profileHTML);

        console.log('name:', company.doc.name);
        console.log('website:', website);
        _context4.next = 13;
        return regeneratorRuntime.awrap(putWrapper(company, { website: website }));

      case 13:
        return _context4.abrupt('return', _context4.sent);

      case 14:
      case 'end':
        return _context4.stop();
    }
  }, null, this);
}

function promiseDebounce(fn, delay, count) {
  var working = 0,
      queue = [];
  function work() {
    if (queue.length === 0 || working === count) return;
    working++;
    _bluebird2.default.delay(delay).tap(function () {
      working--;
    }).then(work);
    var next = queue.shift();
    next[2](fn.apply(next[0], next[1]));
  }
  return function debounced() {
    var args = arguments;
    return new _bluebird2.default((function (resolve) {
      queue.push([this, args, resolve]);
      if (working < count) work();
    }).bind(this));
  };
}

function getUsesShopify(websiteHTML) {
  if (!websiteHTML) return null;
  var match = websiteHTML.match(/shopify/gi);
  return Boolean(match);
}

function insertUsesShopify(company) {
  var websiteHTML, usesShopify;
  return regeneratorRuntime.async(function insertUsesShopify$(_context5) {
    while (1) switch (_context5.prev = _context5.next) {
      case 0:
        if (!(typeof company.doc.usesShopify !== 'undefined')) {
          _context5.next = 4;
          break;
        }

        console.log('name:', company.doc.name);
        console.log('usesShopify:', 'already set to ' + company.doc.usesShopify);
        return _context5.abrupt('return', company.doc.usesShopify);

      case 4:
        if (company.doc.website) {
          _context5.next = 10;
          break;
        }

        console.log('name:', company.doc.name);
        console.log('usesShopify:', 'no website avilable');
        _context5.next = 9;
        return regeneratorRuntime.awrap(putWrapper(company, { usesShopify: null }));

      case 9:
        return _context5.abrupt('return', null);

      case 10:
        _context5.next = 12;
        return regeneratorRuntime.awrap(cacheRequest(company.doc.website));

      case 12:
        websiteHTML = _context5.sent;

        if (!(websiteHTML === null)) {
          _context5.next = 19;
          break;
        }

        console.log('name:', company.doc.name);
        console.log('usesShopify:', 'website html is null');
        _context5.next = 18;
        return regeneratorRuntime.awrap(putWrapper(company, { usesShopify: null }));

      case 18:
        return _context5.abrupt('return', null);

      case 19:
        usesShopify = getUsesShopify(websiteHTML);

        console.log('name:', company.doc.name);
        console.log('usesShopify:', 'new entry ' + usesShopify);
        _context5.next = 24;
        return regeneratorRuntime.awrap(putWrapper(company, { usesShopify: usesShopify }));

      case 24:
        return _context5.abrupt('return', usesShopify);

      case 25:
      case 'end':
        return _context5.stop();
    }
  }, null, this);
}

/* scan profiles (get website) */
function scanProfiles() {
  var companies, use;
  return regeneratorRuntime.async(function scanProfiles$(_context6) {
    while (1) switch (_context6.prev = _context6.next) {
      case 0:
        _context6.next = 2;
        return regeneratorRuntime.awrap(pouchClient.allDocs({
          include_docs: true
        }));

      case 2:
        companies = _context6.sent;

        // let use = slice(companies.rows, 100, 200)
        use = companies.rows;
        return _context6.abrupt('return', _bluebird2.default.map(use, function (company) {
          return insertCompanyWebsite(company);
        }));

      case 5:
      case 'end':
        return _context6.stop();
    }
  }, null, this);
}

/* scan websites (get shopify) */
function scanWebsites() {
  var companies, use;
  return regeneratorRuntime.async(function scanWebsites$(_context7) {
    while (1) switch (_context7.prev = _context7.next) {
      case 0:
        _context7.next = 2;
        return regeneratorRuntime.awrap(pouchClient.allDocs({
          include_docs: true
        }));

      case 2:
        companies = _context7.sent;

        // let use = slice(companies.rows, 0, 300)
        use = companies.rows;
        return _context7.abrupt('return', _bluebird2.default.map(use, function (company) {
          return insertUsesShopify(company);
        }));

      case 5:
      case 'end':
        return _context7.stop();
    }
  }, null, this);
}

function ensureDesign(doc) {
  var exists;
  return regeneratorRuntime.async(function ensureDesign$(_context8) {
    while (1) switch (_context8.prev = _context8.next) {
      case 0:
        _context8.next = 2;
        return regeneratorRuntime.awrap(pouchClient.get(doc._id));

      case 2:
        exists = _context8.sent;

        if (!exists) {
          _context8.next = 5;
          break;
        }

        return _context8.abrupt('return', exists);

      case 5:
        _context8.next = 7;
        return regeneratorRuntime.awrap(pouchClient.put(doc));

      case 7:
        _context8.next = 9;
        return regeneratorRuntime.awrap(pouchClient.get(doc.id));

      case 9:
        return _context8.abrupt('return', _context8.sent);

      case 10:
      case 'end':
        return _context8.stop();
    }
  }, null, this);
}

var shopifyDesignDoc = {
  "_id": "_design/shopify",
  "language": "javascript",
  "views": {
    "shopify": {
      "map": (function (doc) {
        if (doc.usesShopify === true) {
          emit(null, doc.website);
        }
      }).toString()
    }
  }
};

function createCsv() {
  var _companies, companies, companiesCSV, filePath;

  return regeneratorRuntime.async(function createCsv$(_context9) {
    while (1) switch (_context9.prev = _context9.next) {
      case 0:
        _context9.next = 2;
        return regeneratorRuntime.awrap(pouchClient.allDocs({
          include_docs: true
        }));

      case 2:
        _companies = _context9.sent;
        companies = _companies.rows;

        companies = companies.map(function (company) {
          return {
            name: company.doc.name,
            website: company.doc.website
          };
        });
        _context9.next = 7;
        return regeneratorRuntime.awrap(_csv2.default.stringifyAsync(companies, { header: true }));

      case 7:
        companiesCSV = _context9.sent;
        filePath = _path2.default.join(__dirname, '..', 'data', 'nyc-companies.csv');
        _context9.next = 11;
        return regeneratorRuntime.awrap(_fs2.default.writeFileAsync(filePath, companiesCSV));

      case 11:
        return _context9.abrupt('return', companiesCSV);

      case 12:
      case 'end':
        return _context9.stop();
    }
  }, null, this);
}

function createShopifyCsv() {
  var _shops, shops, companiesCSV, filePath;

  return regeneratorRuntime.async(function createShopifyCsv$(_context10) {
    while (1) switch (_context10.prev = _context10.next) {
      case 0:
        _context10.next = 2;
        return regeneratorRuntime.awrap(ensureDesign(shopifyDesignDoc));

      case 2:
        _context10.next = 4;
        return regeneratorRuntime.awrap(pouchClient.query('shopify/shopify'));

      case 4:
        _shops = _context10.sent;
        shops = _shops.rows;

        shops = shops.map(function (company) {
          return {
            'website': shop.value
          };
        });
        _context10.next = 9;
        return regeneratorRuntime.awrap(_csv2.default.stringifyAsync(companies, { header: true }));

      case 9:
        companiesCSV = _context10.sent;
        filePath = _path2.default.join(__dirname, '..', 'data', 'nyc-shopify-companies.csv');
        _context10.next = 13;
        return regeneratorRuntime.awrap(_fs2.default.writeFileAsync(filePath, companiesCSV));

      case 13:
        return _context10.abrupt('return', companiesCSV);

      case 14:
      case 'end':
        return _context10.stop();
    }
  }, null, this);
}

function main() {
  return regeneratorRuntime.async(function main$(_context11) {
    while (1) switch (_context11.prev = _context11.next) {
      case 0:
      case 'end':
        return _context11.stop();
    }
  }, null, this);
}

// let NOC = await numberOfCompanies()
// let NOP = numberOfPages(NOC)
// let count = await pouchClient.info()
// await scanPages(NOP)
// await scanProfiles()
// await scanWebsites()
// await createCsv()
// await createShopifyCsv()
main().then(console.log).catch(function (err) {
  return console.log(err.stack);
}).then(function () {
  return redisClient.quit();
});