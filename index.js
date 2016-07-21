"use strict";

var serialport = require('serialport');
var Promise = require('promise');

exports.Modem = Modem;
exports.Command = Command;
exports.Notification = Notification;

const CommandStateInit      = 'init';
const CommandStateRejected  = 'rejected';
const CommandStateRunning   = 'running';
const CommandStateFinished  = 'finished';
const CommandStateTimeout   = 'timeout';
const CommandStateAborted   = 'aborted';

exports.CommandStates = {
    Init        : CommandStateInit,
    Rejected    : CommandStateRejected,
    Running     : CommandStateRunning,
    Finished    : CommandStateFinished,
    Timeout     : CommandStateTimeout,
    Aborted     : CommandStateAborted
};


var NextId = 1;

function getNextId(){
    return NextId++;
}

function Modem(config)
{
    this.serial = false;

    this.inbuf = new Buffer(0);

    this.events = {};

    this.setConfig(config);

    this.bufferTimeout = 0;
    this.processCommands = false;
    this.currentCommand = false;
    this.pendingCommands = [];

    this.notifications = {};
}

function Command(buf, expectedResult, resultCallback, resultProcessor)
{
    this.id = getNextId();
    this.state = CommandStateInit;

    this.buf = buf;

    this.result = false;

    if (typeof expectedResult === 'undefined') {
        this.expectedResult = 'OK';
    } else {
        this.expectedResult = expectedResult;
    }

    if (typeof resultProcessor === 'function') {
        this.resultProcessor = resultProcessor;
    } else if (typeof resultProcessor === 'undefined' || resultProcessor === true) {
        if (typeof this.expectedResult === 'string') {
            this.resultProcessor = function(buf, result) {
                if (result instanceof Array){
                    return result[1] == this.expectedResult;
                } else {
                    return result == this.expectedResult;
                }
            };
        } else if (this.expectedResult instanceof RegExp) {
            this.resultProcessor = function(buf, matches) {
                return matches;
            }
        } else if (typeof this.expectedResult === 'number') {
            this.resultProcessor = function(buf, matches) {
                return buf;
            }
        }
    }

    if (typeof resultCallback === 'function') {
        this.resultCallback = resultCallback;
    }
}

function Notification(name, regex, handler)
{
    this.name = name;
    this.regex = regex;
    this.handler = handler;
}

Notification.prototype._generateId = function()
{
    this.id = getNextId();
};

Modem.prototype.getConfig = function()
{
    return this.config;
};

Modem.prototype.setConfig = function(newConfig){

    if (typeof newConfig === 'string'){
        newConfig = JSON.parse(config);
    }
    if (typeof newConfig !== 'object'){
        newConfig = {};
    }


    this.config = Object.assign({
        parser: serialport.parsers.raw,
        baudRate: 115200,
        dataBits: 8,
        stopBits: 1,
        lineRegex: /^\r\n(.+)\r\n/,
        EOL: "\r\n",
        timeout: 5000
    }, newConfig || {});


};

Modem.prototype.open = function(path)
{

    if (this.serial instanceof serialport.SerialPort && this.serial.isOpen()){
        this.serial.close();
    }


    this.serial = new serialport.SerialPort(path, {
        parser: this.config.parser,
        baudRate: this.config.baudRate,
        dataBits: this.config.dataBits,
        stopBits: this.config.stopBits,
        autoOpen: false
    });

    this._registerSerialEvents();

    var serial = this.serial;
    return new Promise(function(resolve, reject){
        serial.open(function(error){
            if (error) reject(error);
            else resolve(serial.isOpen());
        });
    });
};

Modem.prototype._registerSerialEvents = function(){
    var modem = this;

    this.serial.on('open', function(error){
        if (typeof modem.events.open === 'function'){
            modem.events.open(error);
        }
    });
    this.serial.on('data', function(data){
        modem._onData(data);

        if (typeof modem.events.data === 'function'){
            modem.events.data(error);
        }
    });
    this.serial.on('disconnect', function(error){
        // console.log('disconnect');
        if (typeof modem.events.disconnect === 'function'){
            modem.events.disconnect(error);
        }
    });
    this.serial.on('close', function(error){
        // console.log('close');
        if (typeof modem.events.close === 'function'){
            modem.events.close(error);
        }
    });
    this.serial.on('error', function(error){
        // console.log('error', error);

        if (typeof modem.events.error === 'function'){
            modem.events.error(error);
        }
    });

    /*
     var events = ['open','data','close','disconnect','data'];
     for (var i in events){
     var e = events[i];
     this.serial.on(e,function(data){
     console.log(e, data);
     var onEvent = '_on' + e.charAt(0).toUpperCase() + e.slice(1);;
     if (typeof modem[onEvent] === 'function'){
     modem[onEvent](data);
     }
     if (typeof modem.events[e] === 'function'){
     modem.events[e](data);
     }
     });
     }*/
};

Modem.prototype.isOpen = function(){
    if (!this.serial instanceof serialport.SerialPort){
        return false;
    }
    return this.serial.isOpen();
};

Modem.prototype.pause = function(){
    if (!this.serial instanceof serialport.SerialPort){
        return false;
    }
    this.serial.pause();
    return this;
};

Modem.prototype.close = function(cb){
    if (typeof cb !== 'function') {
        if (typeof this.events.close === 'function') {
            cb = this.events.close;
        } else {
            cb = function(){};
        }
    }

    if (this.serial instanceof serialport.SerialPort){
        this.serial.close(cb);
    } else {
        cb();
    }
    return this;
};

Modem.prototype.on = function(event, callback)
{
    this.events[event] = callback;
    return this;
};

Modem.prototype.getInBuffer = function()
{
    return this.inbuf;
};

Modem.prototype.clearInBuffer = function()
{
    this.inbuf = new Buffer(0);
    if (this.bufferTimeout) {
        clearTimeout(this.bufferTimeout);
        this.bufferTimeout = 0;
    }
    return this;
};

Modem.prototype.getPendingCommands = function()
{
    return this.pendingCommands;
};

Modem.prototype.clearPendingCommands = function()
{
    this.pendingCommands = [];
    return this;
};

Modem.prototype.isProcessingCommands = function()
{
    return this.processCommands;
};

Modem.prototype.startProcessing = function()
{
    this.processCommands = true;
    this._checkPendingCommands();
    return this;
};

Modem.prototype.stopProcessing = function(abortCurrent, stopCallback)
{
    this.processCommands =  false;
    if (this.currentCommand instanceof Command && abortCurrent){
        this.abortCurrentCommand();
    }
    if (typeof stopCallback === 'function'){
        // if current command not yet finished, wait until it is done.
        if (this.currentCommand instanceof Command) {
            var modem = null;
            var i = setInterval(function () {
                if (modem.currentCommand instanceof Command){
                    return;
                }
                clearInterval(i);
                stopCallback();
            }, 100);
        } else {
            stopCallback();
        }
    }
    return this;
};

Modem.prototype.getCurrentCommand = function()
{
    return this.currentCommand;
};

Modem.prototype.abortCurrentCommand = function()
{
    this.currentCommand = false;
    this._clearBufferTimeout();
    this._checkPendingCommands();

    return this;
};


Modem.prototype.getNotifications = function()
{
    return this.notifications;
};

Modem.prototype.addNotification = function(notification, regex, handler)
{
    if (notification instanceof Notification){
        this.notifications[notification.name] = notification;
    } else {
        this.notifications[notification] = new Notification(notification, regex, handler);
    }
    return this;
};

Modem.prototype.removeNotification = function(name)
{
    delete this.notifications[name];
    return this;
};

Modem.prototype.clearNotifications = function()
{
    this.notifications = {};
    return this;
};



/**
 * Run command bypassing command list (processing option)
 * @param command
 */
Modem.prototype.run = function(command, expected, cb, processor)
{
    if (!(command instanceof Command)){
        command = new Command(command, expected, cb, processor);
    }
    if (this.currentCommand instanceof Command || this.inbuf.length > 0){
        command.state = CommandStateRejected;
    } else {
        this._run(command);
    }
    return _promiseForCommand(command);
};

/**
 * Add command to processing list
 * @param command
 */
Modem.prototype.addCommand = function(command, expected, cb, processor)
{
    if (!(command instanceof Command)){
        command = new Command(command, expected, cb, processor);
    }
    this.pendingCommands.push(command);
    this._checkPendingCommands();

    return _promiseForCommand(command);
};

function _promiseForCommand(command)
{
    return new Promise(function(resolve, reject){
        command._interval = setInterval(function(){
            if (command.state == CommandStateInit || command.state == CommandStateRunning){
                //just wait until not running anymore
                return;
            }
            clearInterval(command._interval);
            // console.log(command);
            if (command.state == CommandStateFinished){
                if (command.result.processed) {
                    resolve(command.result.processed);
                } else {
                    resolve(command.result);
                }
            } else {
                reject(command);
            }
        },100);
    });
}

/**
 * Read n bytes without writing any command
 * @param n
 * @param cb
 * @returns {*}
 */
Modem.prototype.read = function(n, cb)
{
    return this.run(new Command(false, n, cb));
};

/**
 * Write str/buffer to serial without awaiting any result
 * @param str
 * @param cb
 * @returns {*}
 */
Modem.prototype.write = function(buf, cb)
{
    return this.run(new Command(buf, 0, cb));
}



Modem.prototype._checkPendingCommands = function()
{
    // let current command finish
    if (this.currentCommand instanceof Command){
        return;
    }
    // if not processing just do nothing
    if (!this.processCommands){
        return;
    }
    // if no pending commands, we're done
    if (this.pendingCommands.length == 0){
        return;
    }

    // require there not to be anything left in the buffer, before starting another command
    if (this.inbuf.length > 0){
        this._setBufferTimeout();
        return;
    }

    var command = this.pendingCommands[0];
    this.pendingCommands = this.pendingCommands.slice(1);

    this._run(command);
};

Modem.prototype._run = function(command)
{
    this.currentCommand = command;
    command.state = CommandStateRunning;

    if (typeof command.buf === 'string'){
        // console.log("Serial.write",new Buffer(command.buf), command.buf);
        this.serial.write(command.buf + this.config.EOL);
    } else if (command.buf instanceof Buffer){
        // console.log("Serial.write", command.buf);
        this.serial.write(command.buf);
    }

    this._setBufferTimeout();

    //command._writeTo(this, this.config.EOL);

    // var str = command.str + this.config.EOL;
    // this.serial.write(str);

    // wait until command has been completely written to serial
    // this.serial.drain();
};


Modem.prototype._onData = function(data){
    // update buffer
    // console.log("before!", this.inbuf);

    this.inbuf = Buffer.concat([this.inbuf, data]);

    // console.log("after!", this.inbuf, this.inbuf.toString());

    // this.clear

    // if a command was previously sent, we are expecting a result
    if (this.currentCommand instanceof Command){

        var finishCommand = false;
        var consumeBufBytes = 0;
        var matches = null;

        if (typeof this.currentCommand.expectedResult === 'string') {
            var str = this.inbuf.toString();
            matches = str.match(this.config.lineRegex);
            if (matches) {
                consumeBufBytes = matches[0].length;
                finishCommand = true;
            }
        } else if (this.currentCommand.expectedResult instanceof RegExp){
            var str = this.inbuf.toString();
            matches = str.match(this.currentCommand.expectedResult);
            // console.log("matches?",str, matches, this.currentCommand.expectedResult.source);
            if (matches){
                finishCommand = true;
                consumeBufBytes = matches[0].length;
                // always assume
                // matches = matches[1];
            }
        } else if (typeof this.currentCommand.expectedResult === 'number') {
            console.log('is type number');
            if (this.currentCommand.expectedResult <= this.inbuf.length) {
                finishCommand = true;
                consumeBufBytes = this.currentCommand.expectedResult;
            }
        } else if (typeof this.currentCommand.expectedResult === 'function'){
            consumeBufBytes = this.currentCommand.expectedResult(this.inbuf);
            if (0 < consumeBufBytes){
                finishCommand = true;
            }
        } else {
            throw new Error('Invalid expectedResult for command');
        }


        var consumedBuf;
        if (0 < consumeBufBytes) {
            consumedBuf = this.inbuf.slice(0, consumeBufBytes);
            this.inbuf = this.inbuf.slice(consumeBufBytes);
            // console.log("consumed ",consumeBufBytes,"remaining",this.inbuf);
        }
        if (finishCommand){
            // get copy of relevant buffer contents
            // pass relevant in buffer to result handler
            this._serveCommand(this.currentCommand, CommandStateFinished, consumedBuf, matches);
            // this._setBufferTimeout();
            // this.currentCommand.resultCallback(buf, matches);
        }
    }
    // if (!(this.currentCommand instanceof Command))
    { // if no command was sent, we're likely dealing with an unsolicited notification
        var str = this.inbuf.toString();
        var line = str.match(this.config.lineRegex);
        if (line){
            // cons¿ole.log("matched a line");
            for (var i in this.notifications){
                var matches = str.match(this.notifications[i].regex);
                // console.log("testing ",str," against ", this.notifications[i].regex);
                if (matches !== null){
                    // copy matching buffer

                    var buf = this.inbuf.slice(0, matches[0].length);

                    // console.log("STRIPPING ",buf, buf.toString());

                    // update inbuf consuming matching buffer
                    this.inbuf = this.inbuf.slice(matches[0].length);

                    this._serveNotification(this.notifications[i], buf, matches);
                }
            }

            // this._serveNotification(false, new Buffer(), line);

            // feed notification to generic notification handler
            // if (typeof this.events.notification === 'function'){
            //     this.events.notification(buf);
            // }
        }

        // this._setBufferTimeout();
    }
    this._setBufferTimeout();
};

Modem.prototype._setBufferTimeout = function()
{
    this._clearBufferTimeout();

    var modem = this;
    this.bufferTimeout = setTimeout(function(){
        // console.log("timeout", modem.inbuf);
        if (modem.currentCommand instanceof Command){
            var command = modem.currentCommand;
            command.result = {
                buf: modem.inbuf
            };
            modem.inbuf = new Buffer(0);
            modem.currentCommand = false;
            command.state = CommandStateTimeout;
        } else {
            if (typeof modem.events.discarding === 'function'){
                modem.events.discarding(modem.inbuf);
            }
            modem.inbuf = new Buffer(0);
            modem._checkPendingCommands();
        }
    }, this.config.timeout);
};

Modem.prototype._clearBufferTimeout = function()
{
    if (this.bufferTimeout){
        clearTimeout(this.bufferTimeout);
        this.bufferTimeout = 0;
    }
};

Modem.prototype._serveCommand = function(command, state, buf, matches)
{
    // clear current command
    this.currentCommand = false;

    // set command result
    // command._setResult(buf, matches);
    command.result = {
        buf: buf,
        matches: matches
    };
    if (typeof command.resultProcessor === 'function'){
        command.result.processed = command.resultProcessor(buf, matches);
    }

    // by setting the state to a final state, the promise will finish by itself
    command.state = state;

    // if a result handler has been set specifically, call it
    if (typeof command.resultCallback === 'function'){
        command.resultCallback(command.result.processed);
    }

    // feed command to generic command result handler
    if (typeof this.events.command === 'function'){
        this.events.command(command, command.result.processed);
    }

    // console.log("buffer now ", this.inbuf);
    this._checkPendingCommands();
};

Modem.prototype._serveNotification = function(notification, buf, matches)
{
    if (notification instanceof Notification) {
        // feed matches to notification handler (if set)
        if (typeof notification.handler === 'function') {
            notification.handler(buf, matches);
        }
        // feed notification to specific event handler
        if (typeof this.events[notification.name] === 'function') {
            this.events[notification.name](buf, matches);
        }
    } else {
        // feed notification to generic notification handler
        if (typeof this.events.notification === 'function') {
            this.events.notification(matches);
        }
    }
};
