/*
 * you probably want this for reference: http://www.limitlessled.com/dev/
 */

var stream = require('stream')
  , util = require('util')
  , dgram = require('dgram');

// Give our module a stream interface
util.inherits(LimitlessLEDRGB, stream);

// Export it
module.exports=LimitlessLEDRGB;


const cmdModePrevByte = 0x28;
const cmdModeNextByte = 0x27;
const cmdOffByte = 0x21;
const cmdOnByte = 0x22;
const cmdColourByte = 0x20;
const valByteNA = 0x00;
const cmdEndByte = 0x55;

var whiteLightGroupCommands = {
  "all": { "on": 0x35, "off": 0x39, "night": 0xB9 },
  "1": { "on": 0x38, "off": 0x3B, "night": 0xBB },
  "2": { "on": 0x3D, "off": 0x33, "night": 0xB3 },
  "3": { "on": 0x37, "off": 0x3A, "night": 0xBA },
  "4": { "on": 0x32, "off": 0x36, "night": 0xB6 },
}

/**
 * Creates a new Device Object
 *
 * @property {Boolean} readable Whether the device emits data
 * @property {Boolean} writable Whether the data can be actuated
 *
 * @property {Number} G - the channel of this device
 * @property {Number} V - the vendor ID of this device
 * @property {Number} D - the device ID of this device
 *
 * @property {Function} write Called when data is received from the cloud
 *
 * @fires data - Emit this when you wish to send data to the cloud
 */
//TODO: seperate specific data to be passed in on instantiation
function LimitlessLEDRGB(driver, lightGroup) {

  var self = this;
  
  this.lightGroup = lightGroup;
  console.log( 'Setting up limitless group:', lightGroup );

  // This device will emit data
  this.readable = true;
  // This device can be actuated
  this.writeable = true;

  this.voodooLock = false;
  this.lastBrightness = null;
  this.lastWarmth = null;
  this.lastWasRGB = null;

  this.name = 'LimitlessLED - Group ' + lightGroup.number + ' (' + lightGroup.colorType + ')';
  this.G = lightGroup.number + lightGroup.colorType; // G is a string a represents the channel
  this.V = 0; // 0 is Ninja Blocks' device list
  this.D = lightGroup.colorType == 'rgb' ? 1011 : 1012;
  // 1011 LimitlessLED RGB device id
  // 1012 LimitlessLED White device id

  this.driver = driver;

  /*process.nextTick(function() {
    self.emit('data','0000FF');
  });*/
};

const BLACK = '000000';
const BLUE = '0000FF';
const GREEN = '00FF00';
const CYAN = '00FFFF';
const RED = 'FF0000';
const MAGENTA = 'FF00FF';
const YELLOW = 'FFFF00';
const WHITE = 'FFFFFF';

const LLL_BLUE = 0x10;
const LLL_GREEN = 0x60;
const LLL_CYAN = 0x40;
const LLL_RED = 0xB0;
const LLL_MAGENTA = 0xD0;
const LLL_YELLOW = 0x80;

var colours = [BLUE, GREEN, CYAN, RED, MAGENTA, YELLOW];
var lllColourLookup = [LLL_BLUE, LLL_GREEN, LLL_CYAN, LLL_RED, LLL_MAGENTA, LLL_YELLOW];

/**
 * Called whenever there is data from the cloud
 * This is required if Device.writable = true
 *
 * @param  {String} data The data received
 */
LimitlessLEDRGB.prototype.write = function(data) {
  var self = this;

  // I'm being actuated with data!
  console.log('LimitlessLED setting colour ', data);
  console.log('LimitlessLED options ', this.lightGroup);
  
  if ( data[0] == '{' ) {
    // json, ie light protocol
    var parsed = JSON.parse( data );
    var brightness = parsed.bri / 254.0;
    var on = parsed.on;
    var temp = parsed.ct;
    var nightmode = parsed.nightmode;
    
    if ( this.lightGroup.colorType == 'rgb' ) {
      var cb = function() {
        self.doBrightnessVoodoo( brightness );
      };
      if ( on ) {
        cb = function() {
          if ( parsed.sat === 0 ) {
            // white
            self.sendRGBWhiteColorCommand( function() {
              self.doBrightnessVoodoo( brightness );
            } );
          } else {
            // colour
            var brokenHue = 255 - parseInt(parsed.hue / 0xff);
            var resetRed = (brokenHue + 0xb0);
            self.sendRGBColorCommand( resetRed % 0xff, function() {
              self.doBrightnessVoodoo( brightness );
            } );
          }
        };
      }
      self.sendRGBLEDOnCommand( on, cb );
    } else {
      if ( on ) {
        var self = this;
        
        // FIXME: add support for temperature
        
        self.sendWhiteGroupCommand( 'on', function() {
          self.doBrightnessVoodoo( brightness, function() {
            // now do the temperature change
            self.doWarmthVoodoo( (temp - 154.0) / (500.0 - 154.0) );
          } );
        } );
      } else {
        this.sendWhiteGroupCommand( 'off' );
      }
    }
    
    self.emit('data', data);
  } else {
    // fall back to icky old code
    if (this.lightGroup.colorType == 'white') {
      if (data == BLACK) {
        console.log( 'Off' );
        this.sendWhiteGroupCommand( 'off' );
      } else {
        console.log( 'On' );
        this.sendWhiteGroupCommand( 'on' );
      }
      self.emit('data', data);
      return;
    }
  
    var functionToCall;
    var turnOnFirst = false;
    if (data == BLACK) {
      functionToCall = function () {
        setRGBLED(0, this.driver._opts.ipAddress, this.driver._opts.port);
      }.bind(this);
    }
    else if (data == WHITE) {
      functionToCall = function () {
        setRGBMode(MODEPREV, this.driver._opts.ipAddress, this.driver._opts.port);
      }.bind(this);
      turnOnFirst = true;
    }
    else { //may be a colour
      var colourIndex = colours.indexOf(data);
      if (colourIndex != -1) { //is a colour
        functionToCall = function() {
          setRGBColour(lllColourLookup[colourIndex], this.driver._opts.ipAddress, this.driver._opts.port);
        }.bind(this);
      turnOnFirst = true;
      }
    }
    if (typeof functionToCall !== 'undefined') {
      if (turnOnFirst) {
        setRGBLED(1, this.driver._opts.ipAddress, this.driver._opts.port,  functionToCall);
      }
      else {
        functionToCall();
      }
      self.emit('data', data);
    }
  }
};

LimitlessLEDRGB.prototype.doWarmthVoodoo = function( warmth, completion ) {
  // sorry for copy paste :(
    
  if ( this.lastWarmth == warmth ) {
    if (completion) completion( );
    return;
  }
  
  this.lastWarmth = warmth;
  
  if ( this.voodooLock ) {
    if (completion) completion( );
    return;
  }
  
  this.voodooLock = true;
  
  var self = this;
  var warmthScaled = parseInt(warmth * 10);

  if ( warmthScaled > 5 ) {
    // up ...
    self.repeatCommand( function( callback ) {
      self.sendWarmthUpCommand( callback );
    }, 10, function() {
      // and down
      self.repeatCommand( function( callback ) {
        self.sendWarmthDownCommand( callback );
      }, 10 - warmthScaled, function() {
        //console.log( "DONE" );
        self.voodooLock = false;
        if (completion) completion( );
      } );
    } );
  } else {
    // down ...
    self.repeatCommand( function( callback ) {
      self.sendWarmthDownCommand( callback );
    }, 10, function() {
      // and up
      self.repeatCommand( function( callback ) {
        self.sendWarmthUpCommand( callback );
      }, warmthScaled, function() {
        //console.log( "DONE" );
        self.voodooLock = false;
        if (completion) completion( );
      } );
    } );
  }
};

LimitlessLEDRGB.prototype.doBrightnessVoodoo = function( brightness, completion ) {
  if ( this.lastBrightness == brightness ) {
    if (completion) completion( );
    return;
  }
  
  this.lastBrightness = brightness;
  
  if ( this.voodooLock ) {
    if (completion) completion( );
    return;
  }
  
  this.voodooLock = true;
  
  var self = this;
  var brightnessScaled = parseInt(brightness * 10);

  if ( brightnessScaled > 5 ) {
    // up ...
    self.repeatCommand( function( callback ) {
      self.sendBrightnessUpCommand( callback );
    }, 10, function() {
      // and down
      self.repeatCommand( function( callback ) {
        self.sendBrightnessDownCommand( callback );
      }, 10 - brightnessScaled, function() {
        //console.log( "DONE" );
        self.voodooLock = false;
        if (completion) completion( );
      } );
    } );
  } else {
    // down ...
    self.repeatCommand( function( callback ) {
      self.sendBrightnessDownCommand( callback );
    }, 10, function() {
      // and up
      self.repeatCommand( function( callback ) {
        self.sendBrightnessUpCommand( callback );
      }, brightnessScaled, function() {
        //console.log( "DONE" );
        self.voodooLock = false;
        if (completion) completion( );
      } );
    } );
  }
};

LimitlessLEDRGB.prototype.sendRGBColorCommand = function( hueVal, callback ) {
  if ( !this.lastWasRGB ) {
    this.lastBrightness = null; // reset brightness due to mode change
  }
  this.lastWasRGB = true;
  
  console.log( 'Hue value:', hueVal );
  sendUDPCommand(cmdColourByte, hueVal, this.driver._opts.ipAddress, this.driver._opts.port, callback);
};

LimitlessLEDRGB.prototype.sendRGBWhiteColorCommand = function( callback ) {
  var self = this;
  if ( this.lastWasRGB ) {
    this.lastBrightness = null; // reset brightness due to mode change
  }
  this.lastWasRGB = false;
  
  // the highest mode is "20" so we need to "mode down" 20 times to guarentee we get to white (UGH!)
  
  self.repeatCommand( function( callback ) {
    sendUDPCommand(cmdModePrevByte, 0, self.driver._opts.ipAddress, self.driver._opts.port, callback, 50);
  }, 20, callback );
};

LimitlessLEDRGB.prototype.repeatCommand = function( toRepeat, times, completion ) {
  if ( times > 0 ) {
    var remaining = times;
  
    var doNext = function( ) {
      //console.log( 'remaining', remaining );
      remaining -= 1;
    
      if ( remaining < 0 ) {
        completion( );
      } else {
        toRepeat( doNext );
      }
    };
  
    //console.log( 'GO!' );
    doNext( );
  } else {
    completion( );
  }
};

LimitlessLEDRGB.prototype.sendBrightnessUpCommand = function(callback) {
  var cmdByte = this.lightGroup.colorType == 'rgb' ? 0x23 : 0x3C;
  sendUDPCommand(cmdByte, valByteNA, this.driver._opts.ipAddress, this.driver._opts.port, callback);
};

LimitlessLEDRGB.prototype.sendBrightnessDownCommand = function(callback) {
  var cmdByte = this.lightGroup.colorType == 'rgb' ? 0x24 : 0x34;
  sendUDPCommand(cmdByte, valByteNA, this.driver._opts.ipAddress, this.driver._opts.port, callback);
};

LimitlessLEDRGB.prototype.sendWarmthUpCommand = function(callback) {
  var cmdByte = 0x3E;
  sendUDPCommand(cmdByte, valByteNA, this.driver._opts.ipAddress, this.driver._opts.port, callback);
};

LimitlessLEDRGB.prototype.sendWarmthDownCommand = function(callback) {
  var cmdByte = 0x3F;
  sendUDPCommand(cmdByte, valByteNA, this.driver._opts.ipAddress, this.driver._opts.port, callback);
};

LimitlessLEDRGB.prototype.sendWhiteGroupCommand = function(cmd, callback) {
  var cmdByte = whiteLightGroupCommands[this.lightGroup.number][cmd];
  sendUDPCommand(cmdByte, valByteNA, this.driver._opts.ipAddress, this.driver._opts.port, callback);
};

LimitlessLEDRGB.prototype.sendRGBLEDOnCommand = function(on, callback) {
  var cmdByte = (on ? cmdOnByte : cmdOffByte);
  sendUDPCommand(cmdByte, valByteNA, this.driver._opts.ipAddress, this.driver._opts.port, callback);
};

function setRGBLED(on, ipAddress, port, callback) {
  var cmdByte = (on ? cmdOnByte : cmdOffByte);
  sendUDPCommand(cmdByte, valByteNA, ipAddress, port, callback);
}

const MODENEXT = true;
const MODEPREV = false;
function setRGBMode(nextMode, ipAddress, port) {
  var cmdByte = (nextMode ? cmdModeNextByte : cmdModePrevByte);
  sendUDPCommand(cmdByte, valByteNA, ipAddress, port);
}

function setRGBColour(valueByte, ipAddress, port) {
  sendUDPCommand(cmdColourByte, valueByte, ipAddress, port);
}

function sendUDPCommand(cmdByte, valByte, ipAddress, port, callback, timeout) {
  //console.log( ipAddress );
  var didFinishSend = function (err, bytes) {
    client.close();
    if (typeof callback !== 'undefined') {
      setTimeout(callback, timeout ||100);
    }
  }
  var cmd = new Buffer([cmdByte, valByte, cmdEndByte]);
  var client = dgram.createSocket('udp4');
  client.send(cmd, 0, cmd.length, port, ipAddress, didFinishSend)
}

