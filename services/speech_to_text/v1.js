/**
 * Copyright 2014 IBM Corp. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

var extend         = require('extend');
var helper         = require('../../lib/helper');
var cookie         = require('cookie');
var pick           = require('object.pick');
var url            = require('url');
var https          = require('https');
var http           = require('http');
var isStream       = require('isstream');
var requestFactory = require('../../lib/requestwrapper');
var qs             = require('querystring');
var Duplex         = require('stream').Duplex;
var util           = require('util');
var WebSocketClient = require('websocket').client;
var pkg         = require('../../package.json');

var PARAMS_ALLOWED = ['continuous', 'max_alternatives', 'timestamps', 'word_confidence', 'inactivity_timeout',
  'model', 'content-type', 'interim_results', 'keywords', 'keywords_threshold', 'word_alternatives_threshold' ];

function formatChunk(chunk) {
  // Convert the string into an array
  var result = chunk;

  // Check if in the stream doesn't have
  // two results together and parse them
  if (!result || result.indexOf('}{') === -1)
    return JSON.parse(result);

  // Check if we can parse the response
  try {
    result = '[' + result.replace(/}{/g, '},{') + ']';
    result = JSON.parse(result);
    return result[result.length - 1];
  } catch (e) {}

  return result;
}

/**
 * Speech Recognition API Wrapper
 * @constructor
 * @param options
 */
function SpeechToText(options) {
  // Default URL
  var serviceDefaults = {
    url: 'https://stream.watsonplatform.net/speech-to-text/api'
  };

  // Replace default options with user provided
  this._options = extend(serviceDefaults, options);
}

/**
 * Speech recognition for given audio using default model.
 *
 * @param {Audio} [audio] Audio to be recognized.
 * @param {String} [content_type] Content-type
 */
SpeechToText.prototype.recognize = function(params, callback) {

  var missingParams = helper.getMissingParams(params, ['audio', 'content_type']);
  if (missingParams) {
    callback(new Error('Missing required parameters: ' + missingParams.join(', ')));
    return;
  }
  if (!isStream(params.audio)) {
    callback(new Error('audio is not a standard Node.js Stream'));
    return;
  }

  var queryParams = pick(params, ['continuous', 'max_alternatives', 'timestamps',
    'word_confidence','inactivity_timeout', 'model']);

  var _url = '/v1';
  _url += (params.session_id) ? ('/sessions/' + params.session_id) : '';
  _url += '/recognize';

  var parameters = {
    options: {
      method: 'POST',
      url: _url,
      headers: {
        'Content-Type': params.content_type
      },
      json: true,
      qs: queryParams,
    },
    defaultOptions: this._options
  };
  return params.audio.on('response', function(response) {
    // Replace content-type
    response.headers['content-type'] = params.content_type;
  }).pipe(requestFactory(parameters, callback));
};

/**
 * Creates a HTTP/HTTPS request to /recognize and keep the connection open.
 * Sets 'Transfer-Encoding': 'chunked' and prepare the connection to send
 * chunk data
 *
 * @param {String} [content_type] The Content-type e.g. audio/l16; rate=48000
 * @param {String} [session_id] The session id
 * @deprecated use createRecognizeStream instead
 */
SpeechToText.prototype.recognizeLive = function(params, callback) {
  var missingParams = helper.getMissingParams(params,
    ['session_id', 'content_type', 'cookie_session']);

  if (missingParams) {
    callback(new Error('Missing required parameters: ' + missingParams.join(', ')));
    return;
  }

  var serviceUrl = [this._options.url, '/v1/sessions/', params.session_id, '/recognize'].join('');
  var parts = url.parse(serviceUrl);
  var options = {
    agent: false,
    host: parts.hostname,
    port: parts.port,
    path: parts.pathname + (params.continuous == true ? '?continuous=true' : ''),
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + this._options.api_key,
      'Transfer-Encoding': 'chunked',
      'cookie': 'SESSIONID=' + params.cookie_session,
      'Content-type': params.content_type
    }
  };
  var protocol = (parts.protocol.match('http:')) ? http : https;
  var recognize_req = protocol.request(options, function(result) {
    result.setEncoding('utf-8');
    var transcript = '';

    result.on('data', function(chunk) {
      transcript += chunk;
    });

    result.on('end', function() {
      try {
        transcript = formatChunk(transcript);
      } catch (e) {
        callback(transcript);
        return;
      }
      callback(null, transcript);
    });
  });

  recognize_req.on('error', function(error) {
    callback(error);
  });
  return recognize_req;
};

/**
 * Result observer for upcoming or ongoing recognition task in the session.
 * This request has to be started before POST on recognize finishes,
 * otherwise it waits for the next recognition.
 *
 * @param {String} [params.session_id] Session used in the recognition.
 * @param {boolean} [params.interim_results] If true, interim results will be returned. Default: false.
 * @deprecated use createRecognizeStream instead
 */
SpeechToText.prototype.observeResult = function(params, callback) {
  var missingParams = helper.getMissingParams(params, ['session_id', 'cookie_session']);
  if (missingParams) {
    callback(new Error('Missing required parameters: ' + missingParams.join(', ')));
    return;
  }
  var serviceUrl = [this._options.url, '/v1/sessions/',
    params.session_id, '/observe_result'].join('');
  var parts = url.parse(serviceUrl);
  var options = {
    agent: false,
    host: parts.hostname,
    port: parts.port,
    path: parts.pathname + (params.interim_results == true ? '?interim_results=true' : ''),
    method: 'GET',
    headers: {
      'Authorization': 'Basic ' + this._options.api_key,
      'cookie': 'SESSIONID=' + params.cookie_session,
      'Accept': 'application/json'
    }
  };
  var protocol = (parts.protocol.match('http:')) ? http : https;
  var req = protocol.request(options, function(result) {
    result.setEncoding('utf-8');
    result.on('data', function(chunk) {
      try {
        chunk = formatChunk(chunk);
      } catch (e) {
        callback(chunk);
        return;
      }
      callback(null, chunk);
    });
  });

  req.on('error', function(error) {
    callback(error);
  });

  req.end();

  return req;
};

/**
 * Get the state of the engine to check if recognize is available.
 * This is the way to check if the session is ready to accept a new recognition task.
 * The returned state has to be 'initialized' to be able to do recognize POST.
 *
 * @param {String} [params.session_id] Session used in the recognition.
 * @deprecated use createRecognizeStream instead
 */
SpeechToText.prototype.getRecognizeStatus = function(params, callback) {
  var missingParams = helper.getMissingParams(params, ['session_id']);
  if (missingParams) {
    callback(new Error('Missing required parameters: ' + missingParams.join(', ')));
    return;
  }

  var path = params || {};
  var parameters = {
    options: {
      method: 'GET',
      url: '/v1/sessions/' + path.session_id + '/recognize',
      path: path,
      json: true
    },
    defaultOptions: this._options
  };
  return requestFactory(parameters, callback);
};

/**
 * List of models available.
 *
 */
SpeechToText.prototype.getModels = function(params, callback) {
  var parameters = {
    options: {
      method: 'GET',
      url: '/v1/models',
      path: params,
      json: true
    },
    defaultOptions: this._options
  };
  return requestFactory(parameters, callback);
};

/**
 * Get information about a model based on the given model_id
 * @param {String} [params.model_id] The desired model
 *
 */
SpeechToText.prototype.getModel = function(params, callback) {
  var path = params || {};

  var parameters = {
    options: {
      method: 'GET',
      url: '/v1/models/' + path.model_id,
      path: path,
      json: true
    },
    requiredParams: ['model_id'],
    defaultOptions: this._options
  };
  return requestFactory(parameters, callback);
};

/**
 * Create a session
 * Set-cookie header is returned with a cookie that must be used for
 * each request using this session.
 * The session expires after 15 minutes of inactivity.
 * @param string model The model to use during the session
 */
SpeechToText.prototype.createSession = function(params, callback) {
  var parameters = {
    options: {
      method: 'POST',
      url: '/v1/sessions',
      json: true,
      qs: params
    },
    defaultOptions: this._options
  };

  // Add the cookie_session to the response
  function addSessionId(cb) {
    return function(error, body, response) {
      if (error) {
        cb(error, body, response);
        return;
      }
      var cookies = cookie.parse(response.headers['set-cookie'][0]);
      body.cookie_session = cookies.SESSIONID;
      cb(error, body, response);
    };
  }

  return requestFactory(parameters, addSessionId(callback));
};

/**
 * Deletes the specified session.
 *
 * @param {String} [params.session_id] Session id.
 */
SpeechToText.prototype.deleteSession = function(params, callback) {
  var missingParams = helper.getMissingParams(params, ['session_id']);
  if (missingParams) {
    callback(new Error('Missing required parameters: ' + missingParams.join(', ')));
    return;
  }

  var parameters = {
    options: {
      method: 'DELETE',
      url: '/v1/sessions/' + params.session_id,
      json: true
    },
    defaultOptions: this._options
  };
  return requestFactory(parameters, callback);
};

/**
 * pipe()-able Node.js Readable/Writeable stream - accepts binary audio and emits text in it's `data` events.
 * Also emits `results` events with interim results and other data.
 *
 * Cannot be instantiated directly, instead reated by calling #createRecognizeStream()
 *
 * Uses WebSockets under the hood. For audio with no recognizable speech, no `data` events are emitted.
 * @param options
 * @constructor
 */
function RecognizeStream(options){
  Duplex.call(this, options);

  var queryParams = extend({model: 'en-US_BroadbandModel'}, pick(options, ['model', 'X-Watson-Learning-Opt-Out', 'watson-token']));

  var openingMessage = extend({
    // todo: confirm the mixed underscores/hyphens and/or get it fixed
    action: 'start',
    'content-type': 'audio/wav', // todo: try to determine content-type from the file extension if available
    'continuous': true,
    'interim_results': true
  }, pick(options, PARAMS_ALLOWED));

  var closingMessage = {action: 'stop'};

  var url = options.base_url.replace(/^http/, 'ws') + '/v1/recognize?' + qs.stringify(queryParams);

  this.listening = false;

  var client = this.client = new WebSocketClient();
  var self = this;

  // when the input stops, let the service know that we're done
  self.on('finish', function() {
    if (self.connection) {
      self.connection.sendUTF(JSON.stringify(closingMessage));
    } else {
      this.once('connect', function () {
        self.connection.sendUTF(JSON.stringify(closingMessage));
      });
    }
  });

  /**
   * @event RecognizeStream#error
   */
  function emitError(msg, frame, err) {
    if (err) {
      err.message = msg + ' ' + err.message;
    } else {
      err = new Error(msg);
    }
    err.raw = frame;
    self.emit('error', err);
  }

  this.client.on('connectFailed', function(error) {
    self.emit('error', error);
  });

  this.client.on('connect', function(connection) {
    self.connection = connection;

    connection.on('error', function(error) {
      self.listening = false;
      self.emit('error', error);
    });

    connection.on('close', function(reasonCode, description) {
      self.listening = false;
      self.push(null);
      /**
       * @event RecognizeStream#connection-close
       * @param {Number} reasonCode
       * @param {String} description
       */
      self.emit('connection-close', reasonCode, description);
    });

    connection.on('message', function(frame) {
      if (frame.type !== 'utf8') {
        return emitError('Unexpected binary data received from server', frame);
      }

      var data;
      try {
        data = JSON.parse(frame.utf8Data);
      } catch (jsonEx) {
        return emitError('Invalid JSON received from service:', frame, jsonEx);
      }

      if (data.error) {
        emitError(data.error, frame);
      } else if(data.state === 'listening') {
        // this is emitted both when the server is ready for audio, and after we send the close message to indicate that it's done processing
        if (!self.listening) {
          self.listening = true;
          self.emit('listening');
        } else {
          connection.close();
        }
      } else if (data.results) {
        /**
         * Object with interim or final results, including possible alternatives. May have no results at all for empty audio files.
         * @event RecognizeStream#results
         * @param {Object} results
         */
        self.emit('results', data);
        // note: currently there is always either no entries or exactly 1 entry in the results array. However, this may change in the future.
        if(data.results[0] && data.results[0].final && data.results[0].alternatives) {
          /**
           * Finalized text
           * @event RecognizeStream#data
           * @param {String} transcript
           */
          self.push(data.results[0].alternatives[0].transcript, 'utf8'); // this is the "data" event that can be easily piped to other streams
        }
      } else {
        emitError('Unrecognised message from server', frame);
      }
    });

    connection.sendUTF(JSON.stringify(openingMessage));

    self.emit('connect', connection);
  });

  //requestUrl, protocols, origin, headers, extraRequestOptions
  client.connect(url, null, null, options.headers, null);
}
util.inherits(RecognizeStream, Duplex);


RecognizeStream.prototype._read = function(size) {
  // there's no easy way to control reads from the underlying library
  // so, the best we can do here is a no-op
};

RecognizeStream.prototype._write = function(chunk, encoding, callback) {
  var self = this;
  if (this.listening) {
    this.connection.sendBytes(chunk, callback);
  } else {
    this.once('listening', function() {
      self.connection.sendBytes(chunk, callback);
    });
  }
};

/**
 * Replaces recognizeLive & friends with a single 2-way stream over websockets
 * @param params
 * @returns {RecognizeStream}
 */
SpeechToText.prototype.createRecognizeStream = function(params) {
  params = params || {};
  params.base_url = this._options.url;

  // todo: apply these corrections to other methods (?)
  if (params.content_type && !params['content-type']) {
    params['content-type'] = params.content_type;
  }

  if (params['X-WDC-PL-OPT-OUT'] && !params['X-Watson-Learning-Opt-Out']) {
    params['X-Watson-Learning-Opt-Out'] = params['X-WDC-PL-OPT-OUT'];
  }

  params.headers = extend({
    'user-agent': pkg.name + '-nodejs-'+ pkg.version,
    authorization:  'Basic ' + this._options.api_key
  }, params.headers);

  return new RecognizeStream(params);
};

// set up a warning message for the deprecated methods
['recognizeLive', 'observeResult'].forEach(function(name) {
  var original = SpeechToText.prototype[name];
  SpeechToText.prototype[name] = function deprecated(params) {
    if (!(params||{}).silent && !this._options.silent) {
      console.log(new Error('The ' + name + '() method is deprecated and will be removed from a future version of the watson-developer-cloud SDK. ' +
        'Please use createRecognizeStream() instead.\n(Set {silent: true} to hide this message.)'));
    }
    return original.apply(this, arguments);
  };
});

module.exports = SpeechToText;