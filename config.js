'use strict';

var config = {
  quiet: false,
  zone: 0,                                              // zone to poll
  myPort: 1111,                                         // server port
  jrmcServer: '192.168.0.2:52199',                      // jrmc server:port
  myFolder: '/',                                        // proxy to/through internal (xxx/status, xxx/alive)
  jrmcFolder: '/jrmc',                                  // route this/xxx to jrmc/mcws/v1/xxx; ignore if null
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

