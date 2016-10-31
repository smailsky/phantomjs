// usage
// 1、by Host
//  phantomjs netsniff.js ip [domain]
// 2、direct
//  phantomjs netsniff.js domain[ip]
"use strict";
var fs = require('fs');

if (!Date.prototype.toISOString) {
    Date.prototype.toISOString = function() {
        function pad(n) {
            return n < 10 ? '0' + n : n; }

        function ms(n) {
            return n < 10 ? '00' + n : n < 100 ? '0' + n : n }
        return this.getFullYear() + '-' +
            pad(this.getMonth() + 1) + '-' +
            pad(this.getDate()) + 'T' +
            pad(this.getHours()) + ':' +
            pad(this.getMinutes()) + ':' +
            pad(this.getSeconds()) + '.' +
            ms(this.getMilliseconds()) + 'Z';
    }
}

function url2filename(url){
  return url
        .replace(/(http)s?:\/\//g,'')
        .replace(/\./g,'_');
}

function createHAR(address, proxy_host, title, startTime, resources) {
    var entries = [];

    resources.forEach(function(resource) {
        var request = resource.request,
            startReply = resource.startReply,
            endReply = resource.endReply;

        if (!request || !startReply || !endReply) {
            return;
        }

        // Exclude Data URI from HAR file because
        // they aren't included in specification
        if (request.url.match(/(^data:image\/.*)/i)) {
            return;
        }

        entries.push({
            startedDateTime: request.time.toISOString(),
            time: endReply.time - request.time,
            request: {
                method: request.method,
                url: request.url,
                httpVersion: "HTTP/1.1",
                cookies: [],
                headers: request.headers,
                queryString: [],
                headersSize: -1,
                bodySize: -1
            },
            response: {
                status: endReply.status,
                statusText: endReply.statusText,
                httpVersion: "HTTP/1.1",
                cookies: [],
                headers: endReply.headers,
                redirectURL: "",
                headersSize: -1,
                bodySize: startReply.bodySize,
                content: {
                    size: startReply.bodySize,
                    mimeType: endReply.contentType
                }
            },
            cache: {},
            timings: {
                blocked: 0,
                dns: -1,
                connect: -1,
                send: 0,
                wait: startReply.time - request.time,
                receive: endReply.time - startReply.time,
                ssl: -1
            },
            pageref: address
        });
    });

    return {
        log: {
            version: '1.2',
            creator: {
                name: "PhantomJS",
                version: phantom.version.major + '.' + phantom.version.minor +
                    '.' + phantom.version.patch
            },
            pages: [{
                startedDateTime: startTime.toISOString(),
                id: address,
                title: title,
                pageTimings: {
                    onLoad: page.endTime - page.startTime
                }
            }],
            entries: entries
        }
    };
}

var page = require('webpage').create(),
    system = require('system'),
    arg = system.args;
var targetIP = arg[1];
var proxy_host = arg[2];
var hasHost = false;

if (system.args.length === 1) {
    console.log('Usage: netsniff.js <some URL>');
    phantom.exit(1);
} else {
    var customHeaders = {
        "User-Agent": "Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/53.0.2785.101 Safari/537.36"
    };


    if (proxy_host && proxy_host!=='>') {
        customHeaders["Host"] = proxy_host;
        hasHost = true;
    }
    page.customHeaders = customHeaders;
    page.address = targetIP.slice(0,4).toLowerCase()=='http' ? targetIP : 'http://'+targetIP;
    page.resources = [];

    page.onLoadStarted = function() {
        page.startTime = new Date();
    };

    page.onResourceRequested = function(request, network) {
        var noHttpTargetIP = targetIP.replace(/(http)s?:\/\//, '');
        var newUrl = request.url.replace(proxy_host, noHttpTargetIP);
        if (!!~request.url.indexOf(proxy_host)) {
            request.url = newUrl;
            network.setHeader('Host', proxy_host);
            network.changeUrl(newUrl);
        }
        page.resources[request.id] = {
            request: request,
            startReply: null,
            endReply: null
        };
    };

    page.onResourceReceived = function(res) {
        if (res.stage === 'start') {
            page.resources[res.id].startReply = res;
        }
        if (res.stage === 'end') {
            page.resources[res.id].endReply = res;
        }
    };

    page.onInitialized = function() {
        page.customHeaders = {}
    };

    page.open(page.address, function(status) {
        var har;
        if (status !== 'success') {
            console.log('FAIL to load the address');
            phantom.exit(1);
        } else {
            page.endTime = new Date();
            page.title = page.evaluate(function() {
                return document.title;
            });
            har = createHAR(page.address, proxy_host, page.title, page.startTime, page.resources);
            console.log(JSON.stringify(har, undefined, 4));

            var hostStr = hasHost ? '_by_'+url2filename(proxy_host) : '';
            var fileStr = url2filename(page.address) + hostStr;
            var fileName =  fileStr + '.har';
            fs.write(fileName, JSON.stringify(har), 'w');

            var screenName = fileStr + '.png';
            page.render(screenName, { format: 'png', quality: '100' });
            phantom.exit();
        }
    });
}
