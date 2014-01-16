# J River Media Center Proxy/Interface

Simplifies interface for remote devices, helps avoid CORS problems, etc. Emits events for use
 by push notifiers, etc.

### proxy requests to JRMC server

* unchanged
* reformatted as json/jsonp responses


### poll JRMC status

* track operation (playback status, playlist, etc.)
* emit events

### serve additional requests

* polled status, etc. returned as json/jsonp

## Example

#### Paths configured as:
* jrmc: localhost/jrmc/
* internal: localhost/

#### Requests:

###### MCWS alive

```
localhost/jrmc/alive
```

```xml
<Response Status="OK">
<Item Name="RuntimeGUID">{abcdefgh-ijkl-mnop-qrst-uvwxyzABCDEF}</Item>
<Item Name="LibraryVersion">21</Item>
<Item Name="ProgramName">JRiver Media Center</Item>
<Item Name="ProgramVersion">17.0.189</Item>
<Item Name="FriendlyName">Littlemartha</Item>
<Item Name="AccessKey">123456</Item>
</Response>
```

```
localhost/alive?callback=angular.callbacks._15
```

```javascript
angular.callbacks._15(
{"Response":{"Status":"OK","Item":[{"_":"{abcdefgh-ijkl-mnop-qrst-uvwxyzABCDEF}","Name":"RuntimeGUID"},
{"_":"21","Name":"LibraryVersion"},{"_":"JRiver Media Center","Name":"ProgramName"},
{"_":"17.0.189","Name":"ProgramVersion"},{"_":"Littlemartha","Name":"FriendlyName"},{"_":"123456","Name":"AccessKey"}]}}
);
```

```
localhost/alive
```

```javascript
 {"Response":{"Status":"OK","Item":[{"_":"{abcdefgh-ijkl-mnop-qrst-uvwxyzABCDEF}","Name":"RuntimeGUID"},
 {"_":"21","Name":"LibraryVersion"},{"_":"JRiver Media Center","Name":"ProgramName"},{"_":"17.0.189",
 "Name":"ProgramVersion"},{"_":"Littlemartha","Name":"FriendlyName"},{"_":"123456","Name":"AccessKey"}]}}
```

###### Polled Info

```
localhost/info
```

```javascript
{"state":"2","fileKey":"72212","nextFileKey":"778","positionMS":"8490","durationMS":"234292",
"elapsedTimeDisplay":"0:08","remainingTimeDisplay":"-3:46","totalTimeDisplay":"3:54","positionDisplay":"0:08 / 3:54",
"playingNowPosition":"425","playingNowTracks":"474","playingNowPositionDisplay":"426 of 474","playingNowChangeCounter":"505",
"bitrate":"192","sampleRate":"44100","channels":"2","chapter":"0","volume":"0.94999","volumeDisplay":"95%  (-2.5 dB)",
"imageURL":"MCWS/v1/File/GetImage?File=72212","artist":"White Zombie",
"album":"La Sexorcisto: Devil Music, Vol. 1","name":"Thunder Kiss '65","rating":"5","status":"Playing"}
```

## app.js

```javascript
'use strict';

var jrmc = require('jrmc');
var config = require('./config');

// events
// log, logD, logE, logI, error
// request
// status, stateChange, jrmcExists, jrmcPlayState, startTrack, endTrack, changeTrack, imageChange, playlistChange, zoneChange

config.quiet = true;
jrmc.on('error', function(m) {
  console.log(m);
});

jrmc.on('status', function(m) {
  console.log(m);
});

jrmc.on('imageChange', function(m) {
  console.log('* Image Change');
});

jrmc.on('request', function(m) {
  console.log('* Request: ' + m);
});

jrmc.init(config);
jrmc.startServer();
jrmc.startMonitor();

// jrmc.status() - get/set status
// jrmc.state() - get/set state
```

## config.js

```javascript
'use strict';

var config = {
  quiet: false,
  zone: 0,                                              // zone to poll
  myPaths: ['localhost', 'name', '192.168.0.1'],        // server names
  myPort: 1111,                                         // server port
  jrmcProxyPort: 5000,                                  // internal port
  jrmcServer: '192.168.0.2:52199',                      // jrmc server:port
  myFolder: '/',                                        // proxy to/through internal (xxx/status, xxx/alive)
  jrmcFolder: '/jrmc/',                                 // direct to/from jrmc/mcws/v1/
  pollExistsInterval: 60 * 1000,                        // 'running' polling ms
  pollPlayingThresholdStart: 5 * 1000,                  // ms at beginning of song to poll fast
  pollPlayingThresholdEnd: 20 * 1000,                   // ms at end of song to poll fast
  pollSlowPlayingInterval: 10 * 1000,                   // 'playing' slow polling ms
  pollFastPlayingInterval: 0.5 * 1000,                  // 'playing' fast polling ms
  pollPlaylistInterval: 60 * 1000,                      // playlist polling ms
  // fields kept in playlist info (null for all)
  playlistFields: ['Key', 'Artist', 'Album', 'Name', 'Genre', 'Keywords', 'Rating', 'Number Plays']
};

module.exports = module.exports.config = config;
```


