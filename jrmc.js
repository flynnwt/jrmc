'use strict';

// Server/monitor for JRMC
//

// Server:
//  1. pass request to jrmc, return response converted to json or jsonp
//  2. process internally (monitored status, etc.), return json or jsonp
//
// Monitor:
//  1. poll, gather, format useful jrmc info
//
// Events emitted:
//  log, logD, logI, logE, error
//  request, socketIOReady
//  stateChange, status, jrmcExists, jrmcPlayState, info, playlist, playlists
//  startTrack, endTrack, changeTrack, playlistChange, zoneChange, imageChange


/*
 var config = {

 quiet: false,
 zone: 0,                                              // zone to poll
 myPort: 1111,                                         // server port
 jrmcServer: '192.168.0.2:52199',                      // jrmc server:port
 jrmcFolder: '/jrmc',                                  // this/xxx routes to jrmc/mcws/v1/xxx
 pollExistsInterval: 60 * 1000,                        // 'running' polling ms
 pollPlayingThresholdStart: 5 * 1000,                  // ms at beginning of song to poll fast
 pollPlayingThresholdEnd: 20 * 1000,                   // ms at end of song to poll fast
 pollSlowPlayingInterval: 10 * 1000,                   // 'playing' slow polling ms
 pollFastPlayingInterval: 0.5 * 1000,                  // 'playing' fast polling ms
 pollPlaylistInterval: 60 * 1000,                      // playlist polling ms
 // fields kept in playlist info (null for all)
 playlistFields: ['Key', 'Artist', 'Album', 'Name', 'Genre', 'Keywords', 'Rating', 'Number Plays']
 };

 */

var util = require('util'),
    httpProxy = require('http-proxy'),
    http = require('http'),
    jrmcRequest = require('superagent'),
    jrmcPoller = require('superagent'),
    xml2js = require('xml2js'),
    url = require('url'),
    events = require('events'),
    socketio = require('socket.io');

///////////////////////////////////////////////////////////////////////////////

var $ = new events.EventEmitter();

var jrmcServerPath;
var config = {};
var jrmc = {};      // see init() for properties

// create xml parser; make the attrs a property of parent, and don't make single-item arrays
var parser = new xml2js.Parser({mergeAttrs: true, explicitArray: false});

var log = {
  _: function(m) {
    if (!config.quiet) {
      console.log(m);
    }
  },
  d: function(m) {
    $.emit('log', m);
    $.emit('logD', m);
    this._(m);
  },
  i: function(m) {
    $.emit('log', m);
    $.emit('logI', m);
    this._(m);
  },
  e: function(m) {
    $.emit('log', m);
    $.emit('logE', m);
    $.emit('error', m);
    this._(m);
  }
};

var server, io;

function startServer() {

///////////////////////////////////////////////////////////////////////////////
// Internal Server
// /jrmcFolder  - return json/jsonp from jrmc
// /,/status    - return status object
// /info        - return info object
// /image       - current file image
// /playlist    - current playlist info
// /playlists   - all playlists info
// /state?state=<next>  - return state, or set if param
// /zone?zone=<n>       - return current zone, or set if param
// /control?cmd=<play,pause,playpause,stop,prev,next>
//               <volume&val=+x|-x|x>, +/- relative or absolute (0:100%)
//               <position&val=+x|-x|x>, +/- relative or absolute (ms)
//               <rating&val=x> (0=clear, 1:5)
//               <playlist&id=xx&mode=replace|add|insert>           xx=playlist id
//               <playdoctort&id=xx&mode=replace|add|insert>        xx=playlist id
// <others>   - return json/jsonp from jrmc

  http.createServer(function(req, res) {
    var cb, reqUrl, urlParts, query, jrmcUrl, result, contentType, jsonp,
        o, value, params, folders, urlStart, urlRest, mode, id;

    $.emit('request', req.url);

    // get rid of multiple '/' and trailing '/'
    reqUrl = req.url.replace(/\/+/g, '/').replace(/\/$/, '');
    jrmcUrl = (jrmcServerPath + reqUrl).replace(/\/+/g, '/').replace(/\/$/, '');

    urlParts = url.parse(req.url, true);
    urlParts.pathname = urlParts.pathname.replace(/\/+/g, '/').replace(/\/$/, '');
    query = urlParts.query;

    // as long as callback= doesn't hurt jrmc i won't strip it
    contentType = 'application/json';
    jsonp = false;
    cb = query.callback;
    if (cb) {
      contentType = 'application/javascript';
      jsonp = true;
    }

    if (urlParts.pathname === '' || urlParts.pathname === '/') {
      urlParts.pathname = '/status';
    }
    folders = urlParts.pathname.split('/');
    urlStart = '/' + folders[1];

    if (config.jrmcFolder && urlStart === config.jrmcFolder ) {

      urlRest = urlParts.pathname.split('/').slice(2).join('/');
      jrmcUrl = jrmcServerPath + urlRest;
      log.i('JRMC Server: reqUrl=' + reqUrl + '-> getUrl=' + jrmcUrl);
      jrmcReq(req, res, jsonp, contentType, cb, jrmcUrl);
      return;

    } else if (urlStart === '/status') {

      log.i('Local Server: reqUrl=' + reqUrl);
      res.writeHead(200, {'Content-Type': contentType});
      if (jsonp) {
        res.write(cb + '(' + JSON.stringify(jrmc.status) + ');');
      } else {
        res.write(JSON.stringify(jrmc.status));
      }
      res.end();
      return;

    } else if (urlStart === '/info') {

      log.i('Local Server: reqUrl=' + reqUrl);
      res.writeHead(200, {'Content-Type': contentType});
      if (jsonp) {
        res.write(cb + '(' + JSON.stringify(jrmc.info) + ');');
      } else {
        res.write(JSON.stringify(jrmc.info));
      }
      res.end();
      return;

    } else if (urlStart === '/image') {

      log.i('Local Server: reqUrl=' + reqUrl);
      res.writeHead(200, {'Content-Type': 'image'});
      if (jrmc.image) {
        res.write(jrmc.image);
      }
      res.end();
      return;


    } else if (urlStart === '/playlist') {

      log.i('Local Server: reqUrl=' + reqUrl);
      res.writeHead(200, {'Content-Type': contentType});
      if (jsonp) {
        res.write(cb + '(' + JSON.stringify(jrmc.playlist) + ');');
      } else {
        res.write(JSON.stringify(jrmc.playlist));
      }
      res.end();
      return;

    } else if (urlStart === '/playlists') {

      log.i('Local Server: reqUrl=' + reqUrl);
      res.writeHead(200, {'Content-Type': contentType});
      if (jsonp) {
        res.write(cb + '(' + JSON.stringify(jrmc.playlists) + ');');
      } else {
        res.write(JSON.stringify(jrmc.playlists));
      }
      res.end();
      return;

    } else if (urlStart === '/state') {

      log.i('Local Server: reqUrl=' + reqUrl);
      value = query.state;
      res.writeHead(200, {'Content-Type': contentType});
      o = {
        from: jrmc.status.state,
        to: value
      };
      if (value) {
        setState(value);
      }
      if (jsonp) {
        res.write(cb + '(' + JSON.stringify(o) + ');');
      } else {
        res.write(JSON.stringify(o));
      }
      res.end();
      return;

    } else if (urlStart === '/zone') {

      log.i('Local Server: reqUrl=' + reqUrl);
      value = query.zone;
      res.writeHead(200, {'Content-Type': contentType});
      o = {
        from: jrmc.status.zone,
        to: value
      };
      if (value) {
        jrmc.status.zone = value;
      }
      if (jsonp) {
        res.write(cb + '(' + JSON.stringify(o) + ');');
      } else {
        res.write(JSON.stringify(o));
      }
      res.end();
      return;

    } else if (urlStart === '/control') {

      jrmcUrl = jrmcServerPath.replace(/\/$/, '') + '/playback/'; // default, but some don't use playback path!!
      value = query.cmd;
      if (value === 'volume') {
        value = query.val;
        if (value.substring(0, 1) === '+') {
          params = 'level=' + (parseInt(value, 10) / 100) + '&relative=1';
        } else if (value.substring(0, 1) === '-') {
          params = 'level=' + (parseInt(value, 10) / 100) + '&relative=1';
        } else {
          params = 'level=' + (parseInt(value, 10) / 100);
        }
        jrmcUrl += 'volume?' + params + '&zone=' + jrmc.status.zone;
      } else if (value === 'position') {
        value = query.val;
        if (value.substring(0, 1) === '+') {
          params = 'position=' + parseInt(value, 10) + '&relative=1';
        } else if (value.substring(0, 1) === '-') {
          params = 'position=' + (parseInt(value, 10) * -1) + '&relative=-1';
        } else {
          params = 'position=' + parseInt(value, 10);
        }
        jrmcUrl += 'position?' + params + '&zone=' + jrmc.status.zone;
      } else if (value === 'pause') {
        jrmcUrl += 'pause?state=1' + '&zone=' + jrmc.status.zone;
      } else if (value === 'play') {
        jrmcUrl += 'pause?state=0' + '&zone=' + jrmc.status.zone;
      } else if (value === 'prev') {
        jrmcUrl += 'previous?zone=' + jrmc.status.zone;
      } else if (value === 'playlist') {
        id = query.id;
        mode = query.mode;
        if (mode === 'add') {
          mode = '&playmode=add';
        } else if (mode === 'insert') {
          mode = '&playmode=nexttoplay';
        } else {
          mode = '';
        }
        jrmcUrl = jrmcServerPath.replace(/\/$/, '') + '/playlist/files?action=play&playlist=' + id + mode;
      } else if (value === 'playdoctor') {
        id = query.id;
        mode = query.mode;
        if (mode === 'add') {
          mode = '&playmode=add';
        } else if (mode === 'insert') {
          mode = '&playmode=nexttoplay';
        } else {
          mode = '';
        }
        jrmcUrl = jrmcServerPath.replace(/\/$/, '') + '/playlist/files?playdoctor=1&action=play&playlist=' + id + mode;
      } else if (value === 'rating') {
        value = query.val;
        jrmcUrl = jrmcServerPath.replace(/\/$/, '') + '/control/mcc?command=10023&parameter=' + value;
      } else {
        jrmcUrl += value + '?zone=' + jrmc.status.zone;
      }

      log.i('Local Server: reqUrl=' + reqUrl + '-> getUrl=' + jrmcUrl);
      jrmcRequest.get(jrmcUrl, function(err, data) {

        if (err || data.status !== 200 || !data.text) {
          res.writeHead(404, {'Content-Type': 'text/html'});
          result = 'Error: ' + err + ' Status:' + (data ? data.status : 'undefined');
          log.e(result);
          res.write(result);
          res.end();
          return;
        }

        parser.parseString(data.text, function(err, result) {
          if (err) {
            res.writeHead(200, {'Content-Type': 'text/html'});
            result = 'Parsing error!\n' + err;
            log.e(result);
            res.write(result);
          } else {
            res.writeHead(200, {'Content-Type': contentType});
            if (result.Response.Status !== 'OK') {
              result = {
                error: 'Bad Response',
                data: result
              };
            } else {
              result = {
                error: null,
                data: parseResponse(result.Response.Item, null, true)
              };
            }
            if (jsonp) {
              res.write(cb + '(' + JSON.stringify(result) + ');');
            } else {
              res.write(JSON.stringify(result));
            }
          }
          res.end();
        });

      });
      return;

      /*
       } else if (urlParts.pathname === '/test') {

       getPlaylists();
       res.write('ok');
       res.end();
       return;
       */
    } else {

      log.i('JRMC Server: reqUrl=' + reqUrl + '-> getUrl=' + jrmcUrl);
      jrmcReq(req, res, jsonp, contentType, cb, jrmcUrl);
      return;

    }
  }).listen(config.myPort);

  socketIO();

}

function jrmcReq(req, res, jsonp, contentType, cb, jrmcUrl) {

  jrmcRequest.get(jrmcUrl, function(err, data) {
    var result;

    if (err || data.status !== 200) {
      res.writeHead(404, {'Content-Type': 'text/html'});
      result = 'Error: ' + err + ' Status:' + (data ? data.status : 'undefined');
      log.e(result);
      res.write(result);
      res.end();
      return;
    }

    parser.parseString(data.text, function(err, result) {
      if (err) {
        res.writeHead(200, {'Content-Type': 'text/html'});
        result = 'Parsing error!\n' + err;
        log.e(result);
        res.write(result);
      } else {
        res.writeHead(200, {'Content-Type': contentType});
        if (jsonp) {
          res.write(cb + '(' + JSON.stringify(result) + ');');
        } else {
          res.write(JSON.stringify(result));
        }
      }
      res.end();
    });

  });

}

function parseResponse(items, properties, lowerCaseFirst) {
  var i, j, out = {}, newProperty;

  function add(p, v) {
    newProperty = p.replace(/ /g, '');  // no need for spaces
    if (lowerCaseFirst && newProperty.length > 2) {   // don't touch really short ones
      newProperty = newProperty.substr(0, 1).toLowerCase() + newProperty.substr(1);
    }
    out[newProperty] = v;
  }

  if (!items) {
    return out;
  }

  for (i = 0; i < items.length; i++) {
    if (!properties || properties.length === 0) {
      add(items[i].Name, items[i]._);
    } else {
      for (j = 0; j < properties.length; j++) {
        if (items[i].Name === properties[j]) {
          add(properties[j], items[i]._);
          break;
        }
      }
    }
  }
  return out;
}

///////////////////////////////////////////////////////////////////////////////
// Socket.io Interface

function socketIO() {

  //if (config.socketIOPort) {
  io = socketio.listen(server);
  $.emit('socketIOReady', io);
  io.set('log level', 1); // no debug messages

  io.sockets.on('connection', function(socket) {
    socket.emit('connect', { hello: 'world' });
    /*
     socket.on('command', function(data) {
     doCommand(data);
     });
     socket.on('status', function(data) {
     socket.emit('status', db.data);
     });
     */
  });

}

///////////////////////////////////////////////////////////////////////////////
// Monitor

/**
 * setState: change sequencer state
 * @param s
 * @param opts
 * @returns {string}
 */
function setState(s, opts) {

  var i, legal, curState, text,
      allowBad = false,
      transitions = {
        'outtolunch': ['*'],
        'error': ['*'],
        'init': [],
        'start': ['init', 'start', 'error'],
        'idle': ['start', 'idle', 'active', 'startTrack', 'endTrack', 'error'],
        'active': ['start', 'idle', 'active', 'startTrack', 'endTrack', 'error'],
        'startTrack': ['start', 'idle', 'active', 'startTrack', 'endTrack', 'error'],
        'endTrack': ['start', 'idle', 'active', 'startTrack', 'endTrack', 'error']
      };

  curState = jrmc.status.state;
  legal = false;
  if (transitions[s]) {
    for (i = 0; i < transitions[s].length; i++) {
      if (transitions[s][i] === curState || transitions[s][i] === '*') {
        legal = true;
        break;
      }
    }
  }

  if (!legal) {
    log.e('setState(): bad state transition - ' + jrmc.status.state + ',' + s);
  } else if (s !== jrmc.status.state) {
    $.emit('stateChange', jrmc.status.state + ',' + s);
    log.d('stateChange: ' + jrmc.status.state + ',' + s);
  }

  if (!legal && !allowBad) {
    log.e('setState: skipping bad transition');
    setState('outtolunch');
    return;
  }

  switch (s) {
    case 'outtolunch':
      jrmc.status.exists = false;
      jrmc.status.active = false;
      jrmc.status.startTrack = false;
      jrmc.status.endTrack = false;
      jrmc.pollExistsInterval = 0;
      jrmc.pollActiveInterval = 0;
      break;
    case 'error':
      jrmc.status.exists = true;
      jrmc.status.active = false;
      jrmc.status.startTrack = false;
      jrmc.status.endTrack = false;
      jrmc.pollActiveInterval = jrmc.pollSlowPlayingInterval;
      log.e(opts);
      break;
    case 'start':
      jrmc.status.exists = true;
      jrmc.status.active = false;
      jrmc.status.startTrack = false;
      jrmc.status.endTrack = false;
      jrmc.pollActiveInterval = jrmc.pollSlowPlayingInterval;
      if (jrmc.status.state !== 'start') {
        $.emit('jrmcExists');
        jrmc.info = {};
        jrmcActive();
        getZones();
        checkPlaylist();
        getPlaylists();
      }
      text = new Date() + ' ' + jrmc.status.programName + ' ' + jrmc.status.programVersion + ' @' + jrmc.status.friendlyName;
      log.i(text);
      $.emit('status', text);
      break;
    // could differentiate idle from active by slowing/stopping active polling; also would want to force idle->active
    //  on manual events (set active if key pressed, etc.) - /state?state=active
    //
    case 'idle':
      jrmc.status.exists = true;
      jrmc.status.active = true;
      jrmc.status.startTrack = false;
      jrmc.status.endTrack = false;
      jrmc.pollActiveInterval = jrmc.pollSlowPlayingInterval;
      break;
    case 'active':
      jrmc.status.exists = true;
      jrmc.status.active = true;
      jrmc.status.startTrack = false;
      jrmc.status.endTrack = false;
      jrmc.pollActiveInterval = jrmc.pollSlowPlayingInterval;
      break;
    case 'startTrack':
      jrmc.status.exists = true;
      jrmc.status.active = true;
      jrmc.status.startTrack = true;
      jrmc.status.endTrack = false;
      jrmc.pollActiveInterval = jrmc.pollFastPlayingInterval;
      if (jrmc.status.state !== 'startTrack') {
        startTrack();
      }
      break;
    case 'endTrack':
      jrmc.status.exists = true;
      jrmc.status.active = true;
      jrmc.status.startTrack = false;
      jrmc.status.endTrack = true;
      jrmc.pollActiveInterval = jrmc.pollFastPlayingInterval;
      if (jrmc.status.state !== 'endTrack') {
        endTrack();
      }
      jrmc.status.state = 'endTrack';
      break;
    default:
      break;
  }

  jrmc.status.state = s;
  return jrmc.status.state;

}

function jrmcExists() {
  var me = 'jrmcExists';

  // allow re-poll even if active, to check other stuff; else could do that on separate timer
  jrmcPoller.get(jrmcServerPath + jrmc.checkAlive, function(err, data) {

    if (err || data.status !== 200) {
      setState('error', me + ' error: ' + err + '/' + (data ? data.status : 'undefined'));
      clearTimeout(jrmc.timerActive);
    } else {

      getZones();
      getPlaylists();

      parser.parseString(data.text, function(err, result) {
        var response, o, parsed;

        if (err) {
          setState('error', me + ' parse error: ' + err);
          clearTimeout(jrmc.timerActive);
        } else {
          response = result.Response;
          if (response.Status !== 'OK') {
            setState('error', me + ' bad status: ' + response.Status);
            clearTimeout(jrmc.timerActive);
          } else {
            parsed = parseResponse(response.Item, ['ProgramName', 'ProgramVersion', 'FriendlyName', 'AccessKey'], true);
            for (o in parsed) {
              jrmc.status[o] = parsed[o];
            }
            if (!jrmc.status.active) {
              setState('start');
            }
          }
        }
      });
    }

    if (jrmc.pollExistsInterval) {
      jrmc.timerExists = setTimeout(jrmcExists, jrmc.pollExistsInterval);
    }

  });

}

function jrmcActive() {
  var url,
      me = 'jrmcActive';

  clearTimeout(jrmc.timerActive);

  if (jrmc.status.exists) {
    url = jrmcServerPath + jrmc.checkActive + '?zone=' + jrmc.status.zone;
    jrmcPoller.get(url, function(err, data) {

      if (err || data.status !== 200) {
        setState('error', me + ' error: ' + err + '/' + (data ? data.status : 'undefined'));
      } else {
        parser.parseString(data.text, function(err, result) {
          var response, parsed;

          if (err) {
            setState('error', me + ' parser error: ' + err);
            return;
          } else {
            response = result.Response;
            if (response.Status !== 'OK') {
              setState('error', me + ' bad status: ' + response.Status);
              return;
            } else {
              if (!response.Item) { // empty playlist?
                response.status = 'Stopped';
                response.Item = [];
              }
              parsed = parseResponse(response.Item, null, true);
              parsed.status = parsed.status || 'Stopped';   // really?? on first power up
              // Stopped;Paused;Playing;Opening...;Waiting;Aborting, Please wait
              // could use state instead of status
              $.emit('jrmcPlayState', parsed.status);
              if (parsed.status === 'Stopped') {
                setState('idle');
              } else if (parsed.status === 'Paused') {
                setState('active');
              } else {
                if (parsed.positionMS < jrmc.pollPlayingThresholdStart) {
                  setState('startTrack');
                } else if (parsed.durationMS - parsed.positionMS < jrmc.pollPlayingThresholdEnd) {
                  setState('endTrack');
                } else {
                  setState('active');
                }
              }
              if (jrmc.info.fileKey !== parsed.fileKey) {
                changeTrack(parsed);
              }
              jrmc.info = parsed;
              logStatus();
            }
          }
        });
      }

      if (jrmc.pollActiveInterval) {
        jrmc.timerActive = setTimeout(jrmcActive, jrmc.pollActiveInterval);
      }
    });
  }

}

function logStatus() {
  var text;

  text = 'Z' + jrmc.status.zone + ':' + jrmc.info.status;
  if (jrmc.info.state) {
    text += '/' + jrmc.info.state + '/' + jrmc.info.fileKey +
        ' ' + jrmc.info.artist + '/' +
        jrmc.info.album + '/' + jrmc.info.name + ' ' + jrmc.info.positionDisplay + ', ' +
        jrmc.info.volumeDisplay + ' imageSize=' + jrmc.image.length +
        (jrmc.playlist.summary.split(';').length > 2 ? (' (' + (parseInt(jrmc.playlist.summary.split(';')[2], 10) + 1) + ' of ' + jrmc.playlist.summary.split(';')[1] + ')') : '');
  } else {
    text += ' <No info>';
  }
  log.i(text);
  $.emit('status', text);

  if (jrmc.info.status === 'Playing') {
    io.sockets.emit('status', jrmc.status);
    io.sockets.emit('info', jrmc.info);
    io.sockets.emit('playlist', jrmc.playlist);
    io.sockets.emit('playlists', jrmc.playlists);
  }
}

function getImage(key) {

  function binaryParser(res, callback) {
    res.setEncoding('binary');
    res.data = '';
    res.on('data', function(chunk) {
      res.data += chunk;
    });
    res.on('end', function() {
      jrmc.image = new Buffer(res.data, 'binary');
      $.emit('imageChange');
      logStatus();
      callback(null, jrmc.image);
    });
    res.on('error', function(err) {
      callback(err, null);
    });
  }

  if (jrmc.status.exists) {
    jrmcPoller
        .get(jrmcServerPath + jrmc.getImage + key)
        .parse(binaryParser)
        .end();
  }

}

function startTrack() {
  var me = 'startTrack';

  $.emit('startTrack');
  log.i(me);

}

function endTrack() {
  var me = 'endTrack';

  $.emit('endTrack');
  log.i(me);
}

function changeTrack(next) {
  var me = 'changeTrack';

  $.emit('changeTrack');
  log.i(me);
  // save current info on array before it changes? (jrmc.info)
  jrmc.image = new Buffer('', 'binary');
  getImage(next.fileKey);
  checkPlaylist();
}

function checkPlaylist() {
  var url,
      me = 'checkPlaylist';

  clearTimeout(jrmc.timerPlaylist);

  function mplParser(res, callback) {
    var i;

    res.data = '';
    res.on('data', function(chunk) {
      res.data += chunk;
    });
    res.on('end', function() {
      parser.parseString(res.data, function(err, result) {
        if (err) {
          log.e(me + ' parse error: ' + err);
        } else {
          if (!result || !result.MPL || !result.MPL.Item) {
            // happens if no playlist
            jrmc.playlist.info.title = '';
            jrmc.playlist.info.items = [];
            log.i(me + ' bad playlist data!\n' + util.inspect(result, {depth: null}));
          } else {
            jrmc.playlist.info.title = result.MPL.Title;
            jrmc.playlist.info.items = [];
            for (i = 0; i < result.MPL.Item.length; i++) {
              jrmc.playlist.info.items[i] = parseResponse(result.MPL.Item[i].Field, config.playlistFields, true);
            }
            $.emit('playlistChange');
            log.i('New playlist: ' + jrmc.playlist.info.title + ', ' + jrmc.playlist.info.items.length + ' items');
          }
        }
      });
    });
    res.on('error', function(err) {
      log.e(me + ' getPlaylist error: ' + err);
      callback(err, null);
    });
  }

  if (jrmc.status.exists) {

    url = jrmcServerPath + jrmc.getPlaylistSummary + '&zone=' + jrmc.status.zone;
    jrmcPoller.get(url, function(err, data) {
      if (err) {
        log.e(me + ' getPlaylistSummary error: ' + err);
      } else {
        // skip the first 3 entries (?, cur, total)
        if (jrmc.playlist.summary.split(';').slice(3).join(';') !== data.text.split(';').slice(3).join(';')) {
          jrmc.playlist.summary = data.text;
          jrmc.playlist.info = {};
          url = jrmcServerPath + jrmc.getPlaylist + '?zone=' + jrmc.status.zone;
          jrmcPoller
              .get(url)
              .parse(mplParser)
              .end();
        } else {
          jrmc.playlist.summary = data.text;  // the first 3 items may have changed
        }
      }
    });

    jrmc.timerPlaylist = setTimeout(checkPlaylist, config.pollPlaylistInterval);

  }
}

function getPlaylists() {
  var me = 'getPlaylists';

  function mplParser(res, callback) {
    var i;

    res.data = '';
    res.on('data', function(chunk) {
      res.data += chunk;
    });
    res.on('end', function() {
      parser.parseString(res.data, function(err, result) {
        if (err) {
          log.e(me + ' parse error: ' + err);
        } else {
          for (i = 0; i < result.Response.Item.length; i++) {
            jrmc.playlists[i] = parseResponse(result.Response.Item[i].Field, null, true);
          }
        }
      });
    });
    res.on('error', function(err) {
      log.e(me + ' getPlaylist error: ' + err);
      callback(err, null);
    });
  }

  if (jrmc.status.exists) {

    jrmc.playlists = [];
    jrmcPoller
        .get(jrmcServerPath + jrmc.getPlaylists)
        .parse(mplParser)
        .end();

  }

}

function getZones() {
  var parsed,
      me = 'getZones';

  if (jrmc.status.exists) {

    jrmcPoller.get(jrmcServerPath + jrmc.getZones, function(err, data) {
      if (err) {
        log.e(me + '  error: ' + err);
      } else {
        parser.parseString(data.text, function(err, result) {
          if (err) {
            setState('error', me + ' parser error: ' + err);
            return;
          } else {
            parsed = parseResponse(result.Response.Item, null, true);
            if (parsed.currentZoneID !== jrmc.status.zones.currentZoneID) {
              $.emit('zoneChange', parsed.currentZoneID);
            }
            jrmc.status.zones = parsed;
            /* only change zone being watched manually
             if (!jrmc.status.zones.currentZoneID) {
             jrmc.status.zone = -1;
             } else {
             jrmc.status.zone = jrmc.status.zones.currentZoneID;
             }
             */
          }
        });
      }
    });
  }
}

$.init = function(opts) {
  config = opts;
  jrmcServerPath = config.jrmcServer + '/MCWS/v1/';
  jrmc = {
    checkAlive: 'alive',
    checkActive: 'playback/info',
    getImage: 'file/getimage?file=',
    getPlaylistSummary: 'playback/playlist?action=serialize',
    getPlaylist: 'playback/playlist',
    getZones: 'playback/zones',
    getPlaylists: 'playlists/list',
    pollExistsInterval: config.pollExistsInterval,
    pollPlayingThresholdStart: config.pollPlayingThresholdStart,
    pollPlayingThresholdEnd: config.pollPlayingThresholdEnd,
    pollSlowPlayingInterval: config.pollSlowPlayingInterval,
    pollFastPlayingInterval: config.pollFastPlayingInterval,
    pollActiveInterval: 0,
    timerExists: null,
    timerActive: null,
    timerPlaylist: null,
    status: {
      state: 'init',
      exists: false,
      active: false,
      startTrack: false,
      endTrack: false,
      zone: config.zone,
      zones: {}
    },
    info: {},
    image: null,
    playlist: {
      summary: '',
      info: {}
    },
    playlists: null
  };
};

$.startServer = startServer;
$.startMonitor = jrmcExists;
$.status = function(s) {
  if (s) {
    jrmc = s;
  }
  return jrmc;
};
$.state = function(s) {
  if (s) {
    setState(s);
  }
  return jrmc.status.state;
};

module.export = module.exports = $;
