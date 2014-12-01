var async = require('async');
var NOOT = require('noot')('object');
var http = require('http');
var fs = require('fs');
var crypto = require('crypto');
var request = require('request');

http.globalAgent.maxSockets=1000;

var Stat = NOOT.Object.extend({

    id : null,
    requests : {},
    totalTime : 0,
    totalRequests : 0,
    maxLatencyMs: 0,
    totalErrors: 0,
    histogramMs : {},
    options: {},
    errorCodes: {},

    start : function(requestId) {
        requestId = requestId || this.createId();
        this.requests[requestId] = process.hrtime();
        return requestId;
    },

    end : function(requestId, errorCode) {
        if (!(requestId in this.requests))
        {
            log.error('Message id ' + requestId + ' not found');
            return;
        }
        this.add(this.getElapsed(this.requests[requestId]), errorCode, requestId);
        delete this.requests[requestId];
    },

    computePercentiles : function() {
      var self = this;
      var percentiles = {
        50: false,
        90: false,
        95: false,
        99: false
      };
      var counted = 0;

      Object.keys(this.histogramMs).forEach(function(ms) {
        counted += self.histogramMs[ms];
        var percent = counted / self.totalRequests * 100;
        Object.keys(percentiles).forEach(function(percentile) {

          if (!percentiles[percentile] && percent > percentile)
          {
            percentiles[percentile] = ms;
          }
        });
      });
      return percentiles;
    },

    createId : function () {
        var value = '' + Date.now() + Math.random();
        var hash = crypto.createHash('sha256');
        return hash.update(value).digest('hex').toLowerCase();
    },

    getElapsed : function (startTime) {
        var elapsed = process.hrtime(startTime);
        return elapsed[0] * 1000 + elapsed[1] / 1000000;
    },

    add : function (time, errorCode, requestId) {
        this.totalTime += time;
        this.totalRequests++;
        if (errorCode)
        {
            errorCode = '' + errorCode;
            this.totalErrors++;
            if (!(errorCode in this.errorCodes))
            {
                this.errorCodes[errorCode] = 0;
            }
            this.errorCodes[errorCode] += 1;
        }

        var rounded = Math.floor(time);
        if (rounded > this.maxLatencyMs)
        {
            this.maxLatencyMs = rounded;
        }
        if (!this.histogramMs[rounded])
        {
            this.histogramMs[rounded] = 0;
        }
        this.histogramMs[rounded] += 1;

        if (this.isFinished())
        {
           this.report();
        }
    },

    isFinished : function () {
        if (this.totalRequests >= this.options.maxRequests * this.options.concurrency)
        {
            return true;
        }
        return false;
    },

    report : function () {
      console.log('total time : ' + this.totalTime);
      console.log('total requests : ' + this.totalRequests);
      console.log('max latency : ' + this.maxLatencyMs);
      console.log(this.computePercentiles());

      console.log('total errors :' + this.totalErrors);
      console.log(this.errorCodes);
    }

});

var Operation = NOOT.Object.extend({

    stat: {},
    options: {},

    init: function() {
      this.stat = Stat.create({options: this.options})
    },

    sendRequest: function(callback) {
      var self = this;
      var formData = { my_file: fs.createReadStream(__dirname + '/20Mo.data') };
      var id = this.stat.start(id);
      request.post({url:'http://localhost:8893/internal/export', formData: formData}, function optionalCallback(err, res, body) {
        if (res.statusCode != 201)  self.stat.end(id, res.statusCode);
        else self.stat.end(id);
        callback();
      });
    },

    loop: function(callback) {
        var self = this;
        var nbRequest = 0;
        async.whilst(
            function() { return nbRequest < self.options.maxRequests; },
            function(callback) {
              nbRequest++;
              self.sendRequest(callback);
            },
            callback
        );
    },

    start: function() {
        for (var index = 0; index < this.options.concurrency; index++) {
            this.loop(function(){
                console.log('client done');
            });
        }
    }
});

var operation = Operation.create({options: { maxRequests: 125, concurrency: 2}});
operation.start();