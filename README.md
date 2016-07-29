# AT Commander

__Please note that this is still a beta version__

Promise based AT(tention) command handler for serial ports (typically for use with external modem components and the like).

This module is ment to serve only as a basis for your specific device implementations - it is rather device agnostic, so to speak.

For a sample (beta) implementation of a real device see [telit-modem](https://www.npmjs.com/package/telit-modem)

Features:

- Send simple commands and receive boolean success/failure responses
- Catch complex responses and preprocess
- Set up notifications / event handlers for unsolicited messages
- Command queue

This module uses the npm https://www.npmjs.com/package/serialport for serial communication.


## Todos

* Complete documentation..
* Add more serialport configuration options (modem options are passthrough anyway, so just note that in the documentation...)
* Add tests
* Generic refactoring
* Rethink timeout principle - is it ok like this or should it be remodelled? (timeout not absolute to actual command start but relative to last incoming data) (-> process.nextTick ??)

## Possible issues

In case something doesn't work as expected, please first look here.

* After an inbuffer handling change (auto-discard of CR/NL prefixes) reading a specific number of bytes might have an unexpected behaviour. Well, changing this ment a simplification of usage but also a change in semantics as incoming data is being interpreted.

## Overview

* [Usage](#usage)
  * [Example](#example)
  * [Promise based commands](#promise-based-commands)
* [Classes](#classes)
  * [Modem](#modem)
    * [Modem(options)](#modem-options)
    * [getConfig()](#getConfig)
    * [setConfig(options)](#setConfig-options)
    * [open(path)](#open-path)
    * [isOpen()](#isOpen)
    * [pause()](#pause)
    * [close(callback)](#close-callback)
    * [closeGracefully(callback)](#closeGracefully-callback)
    * [on(event, callback)](#on-event-callback)
    * [isProcessingCommands()](#isProcessingCommands)
    * [startProcessing()](#startProcessing)
    * [stopProcessing(abortCurrent, callback)](#stopProcessing-abortCurrent-callback)
    * [getPendingCommands()](#getPendingsCommands)
    * [clearPendingCommands()](#clearPendingCommands)
    * [getCurrentCommand()](#getCurrentCommand)
    * [abortCurrentCommand()](#abortCurrentCommand)
    * [run(command, expected, options)](#run-command-expected-options)
    * [addCommand(command, expected, options)](#addCommand-command-expected-options)
    * [read(n)](#read-n)
    * [write(buf)](#write-buffer)
    * [getInBuffer()](#)
    * [clearInBuffer()](#)
    * [getNotifications()](#)
    * [clearNotifications()](#)
    * [addNotification(name, regex, handler)](#)
    * [removeNotification(name)](#)
  * [Command](#command)
  * [Notification](#notification)
* [Events](#events)

## Usage

### Example

    var ATCommander = require('at-commander');
    var Command = ATCommander.Command;

    // all options are optional, these are the default options
    var opts = {
        // the following options define the options used by serialport
        parser: serialport.parsers.raw,
        baudRate: 115200,
        dataBits: 8,
        stopBits: 1,

        // command termination string (is added to every normal string type command)
        EOL: "\r\n",

        // this regex is used by default to detect one-line responses
        lineRegex: /^\r\n(.+)\r\n/,

        // (default) command timeout
        timeout: 500
    };

    var modem = new ATCommander.Modem(opts);

    var port = 'COM4'; // on Windows
    var port = '/tty/serial/by-id/blabalbla'; // linux based machines

    modem.open(port).catch((err) => {
        console.log("Failed to open serial", err);
    }).then(function(){

        // check if a response is coming
        // NOTE: run(command) bypasses the command queue and is executed immediatly (unless another command is being executed already)
        modem.run('AT').then((success) => {

            modem.startProcessing();

        });

        // fill up command queue
        // queue is only processed it modem.startProcessing() is called.
        modem.addCommand('AT+CMG=1');

        // identical to previous command
        modem.addCommand('AT+CMG=1', undefined);

        // with expected result 'OK' and command specific timeout
        modem.addCommand('AT+FOOO', 'OK', {
            timeout: 10000
        }).then(function(){
            // command got expected response
        }).catch(function(command){
            // some error occurred
        });

        // consider the next incoming 6 bytes as the wanted response
        modem.addCommand('AT+FOOO', 6).then(function(buffer){
            // buffer contains the next 6 incoming bytes (please note, that beginning CR + NL characters are trimmed automatically, thus (at the moment) if you expect to be reading only these characters your logic will fail)
        }).catch(function(command){
            // most likely to fail only if there is a timeout
        });

        modem.addCommand('AT+CREG=?', /\+CREG=(.*),(.*)/).then((matches) => {
            // matches contains the response's string matches according to the given regex
        });

        modem.addCommand('AT+FOOO',  function(buffer){
            // complex response detectors are passed the updated response buffer contents whenever there is new data arriving
            var str = buffer.toString();
            if (str.matches(/^OK/r/n/){
                return 4; // return the byte count the response (these many bytes will be consumed from the buffer)
            }
            return 0; // return 0 if expected response not received yet
        }).then((buffer) => {
            // complex response detectors receive the whole (consumed) buffer as argument
        });


        // add a notification
        modem.addNotification('myEventName', /^+CMI=(.*),(.*)/, function(buffer, matches) {
            modem.addCommand("AT+CMR="+matches[1], parseInt(matches[2])).then((buf) => {
                // buf contains my wanted result
            });
        });


        modem.addNotification('shutdown', /SHUTDOWN/, function(){
            modem.close();
        });
    });

### Promise based commands

The `Modem` methods `run`, `addCommand` return a promise that will be resolved/rejected with variable parameters that depend on the (Command)[#command] options.

The following setup illustrates the differences

    var CommandStates = require('at-commander').CommandStates;

    // please note, it is also possible to call modem.run directly with the arguments as passed to the constructor of command
    // modem.run thus is just a nice wrapper
    var myCommand = new ATCommander.Command(cmd, expected);
    modem.run(myCommand).then(function(result){
        if (typeof expected === 'undefined' || typeof expected === 'string'){
            // result is a boolean denoting wether the one-line response matched the expected value
            // in case expected was undefined, the default response (OK) is assumed
            // NOTE this will have to be refactored to make it configurable on the fly
        }
        if (typeof expected === 'number'){
            // result will be of type Buffer container the number of bytes as denoted by expected
        }
        if (expected instanceof RegExp){
            // result will be the return value of inBufferString.match(expected)
        }
        if (typeof expected === 'function'){
            // result will be the relevant inBuffer part that was detected using expected
        }



    }).catch(function(command){
        // in case of an error, the given object is an instance of Command
        // command is the same object as myCommand

        // furthermore several fields will be set:

        switch (command.state){

            case CommandStates.Init:
                //this state should never occur in an error case
                break;

            case CommandStates.Rejected:
                // this state only occurs when passing a command using .run() (or write(), read())
                // and denotes the situation where the modem is already processing a command
                // (this is because .run() bypasses the command queue)
                break;

            case CommandStates.Running:
                // this state should never occur in an error/catch case
                // it denotes that the command is being processed by the modem
                break;

            case CommandStates.Finished:
                // this state should never occur in an error/catch case
                // it denotes that the command terminated as configured

                // command.result.buf -> read buffer that satisfied the expected result requirements

                break;

            case CommandStates.Failed:
                // this state occurs if the commands result processor function returns an undefined value
                // by default this will also be the case if the expected result is a string type and the read in line
                // did not match (thus causing a rejection)
                // note that if you provide result processor functions yourself, you might want to be aware of this (or
                // make use of it)

                // command.result.buf -> read line that did not match

                break;

            case CommandStates.Timeout:
                // this state denotes that there was no reply from the attached serial device in the given time constraint
                // also the contents of the inBuffer will be passed to the command (and consumed from the inBuffer)

                // command.result.buf -> will be a Buffer object

                break;

            case CommandStates.Aborted:
                // this state denotes that the command was user aborted
                break;
        }


    });


## Classes

### Modem

#### Modem (options)
See [setConfig(options)](#setConfig-options).

#### getConfig ()
Returns config..

#### setConfig (options)
**_options (optional)_**
* `parser`: See https://www.npmjs.com/package/serialport#serialport-path-options-opencallback (Note: likely you will never want to change this!)
* `baudRate`: See https://www.npmjs.com/package/serialport#serialport-path-options-opencallback
* `dataBits`: See https://www.npmjs.com/package/serialport#serialport-path-options-opencallback
* `stopBits`: See https://www.npmjs.com/package/serialport#serialport-path-options-opencallback
* `EOL`: (default: `"\r\n"`) Command termination string (is added to every normal string type command)
* `lineRegex`: (default `"^(.+)\r\n"`) This RegExp is used to detect one-line responses and notifications.
* `timeout`: (default: `500`) default command timeout in millisec as well as the unsolicited notification timeout
* `defaultExpectdResult`: (default: `"OK"`) Expected result if none given (see run(), addCommand)

#### open (path)

**_path_**

Denotes path to serial port (on linux typically something like `/tty/tty.serialXYZ`, on windows `COM4`)

Returns a promise.

#### isOpen ()
Facade for https://www.npmjs.com/package/serialport#isopen

#### pause ()
Facade for https://www.npmjs.com/package/serialport#pause

#### close (callback)
Forces serial shutdown. Facade for https://www.npmjs.com/package/serialport#close-callback

#### closeGracefully (callback)
If tries to finish any pending commands before shutting down serial.


#### on (event, callback)
Please refer to [Events](#events)

#### isProcessingCommands ()
If set to true, command queue will be automatically processed.

#### startProcessing ()
Start automatic processing of command queue.

#### stopProcessing (abortCurrent, callback)
Stop automatic processing of command queue.

**_boolean abortCurrent (optional)_**

**_function callback (optional)_**

Callback to run once abortion completes.


#### getPendingCommands ()
Returns array of pending (Commands)[#command]

#### clearPendingCommands ()
Cleats pending commands list.

#### getCurrentCommand ()
Returns false if no command is pending at the moment, (Command)[#command] otherwise.

#### abortCurrentCommand ()

#### run (command, expected, options)

If and only if no other command is currently being processed, runs the given command

**_string|buffer|Command command (required)_**

If it is a (Command)[#command], any other parameters are ignored, otherwise the string|buffer is used as command to write to the serial.

**_string|number|regex|function expected (optional, default: `OK`)_**

**_object options (optional)_**

* `timeout`: command timeout in msec (if not defined, default of modem is used, see setConfig())
* `resultProcessor`: result preprocessor, it's result will be considered the processed and final result as passed to promise

Returns a promise.


#### addCommand (command, expected, options)

Adds the given command to the pending commands list.
The calling semantics are identical to `run(command, expected, callback, processor)`

Returns a promise.


#### read (n)
Shortcut helper to `run` a command that just reads n bytes.
NOTE: after some refactoring initial CR|NL are automatically discarded and will thus never be read. This will likely have to change..

**_number n (required)_**

Number of bytes to read.

Returns a promise.


#### write (buffer)
Shortcut helper to `run` a command that just writes `buffer` to serial and does not wait for a response.

**_Buffer buffer (required)_**

Buffer to write to serial.

Returns a promise.

#### getInBuffer ()
Get contents of serial in buffer.

#### clearInBuffer ()
Clear contents of serial in buffer.

#### getNotifications ()
Get array of registered notifications.

#### clearNotifications ()
Clear deregister all notifications.

#### addNotification (notification, regex, handler)
Register a new notification.

**_string|Notification notification (required)_**

In case a [Notification](#notification) is passed the remaining parameters are ignored.
Otherwise a string to uniquely identify the notification is expected. Will overwrite any previsouly notifications with the same value.

**_RegExp regex (optional)_**

Matching expression that will be looked out for in the buffer to detect any unsolicited incoming data.

**_function handler(Buffer buffer, Array matches) (optional)_**

Notification handler that will be called once `regex` matches incoming data. Will be passed the whole matches buffer and corresponding matches as arguments.

#### removeNotification (name)
Unregister notification with given name.


### Command

    var Command = require('at-commander').Command;

    var myCommand = new Command(command, expected, options);

    modem.run(myCommand); // or
    modem.addCommand(myCommand);

The constructor semantics are very much identical to the options of [run(command, expected, options)](#run-command-expected-options) which serves as shortcut.

### Notification

    var Notification = require('at-commander').Notification;

    var myNotification = new Notification(name, regex, handler);

    modem.addNotification(myNotification);

Please note that [addNotification(notification, regex, handler)](#addNotification-notification-regex-handler) is the friendly shortcut.

## Events

Event handlers can be set using `Modem.on(eventName, callback)`

### open
Please see https://www.npmjs.com/package/serialport#onopen-callback

### close
https://www.npmjs.com/package/serialport#onclose-callback

### data
Please see https://www.npmjs.com/package/serialport#ondata-callback

### disconnect
Please see https://www.npmjs.com/package/serialport#ondisconnect-callback

### error
Please see https://www.npmjs.com/package/serialport#onerror-callback

### notification
Will be called if any registered notification matches incoming data.
WARNING: currently disabled, will have to be refactored

### command
The command event is triggered if a command _successfully_ completes.

`function callback(Command command, result)`

The type/contents of `result` is according to the command operations (also see section [Promise based commands](#promise-based-commands)).
The most interesting thing about this callback is that it contains the used `Command` object which in particular also has the following interesting properties:

    command.result.buf -> complete accepted response of type Buffer
    command.result.matches -> if and only if an expected response using a matching mechanism is used: the resulting matches
    command.result.processed -> if and only if a (default or custom) processor function is passed to the command (will be the same as result)

### discarding
The discarding event is triggered if the inBuffer discards data due to a timeout.

`function callback(Buffer buffer)`