# AT Commander

Promised based AT(tention) command handler for serial ports (typically for use with external modem components and the like).

Features:

- Send simple commands and receive boolean success/failure responses
- Catch complex responses and preprocess
- Set up notifications / event handlers for unsolicited messages
- Command queue

This module uses the npm https://www.npmjs.com/package/serialport for serial communication.

## Todos

* Complete documentation..
* Add more serialport configuration options
* Add default expected result option
* Consider removing command callback as it works promise based anyways
* Add timeout per command (certain commands may take a while, whereas many will likely terminate quasi-immediately)
* Generic refactoring..

## Overview

* [Example](#example)
* [Classes](#classes)
  * [Modem](#modem)
    * [Modem(options)](#modem-options)
    * [getConfig()](#getConfig)
    * [setConfig(options)](#setConfig-options)
    * [open(path)](#promise open-path)
    * [isOpen()](#isOpen)
    * [pause()](#pause)
    * [close(callback)](#close-callback)
    * [on(event, callback)](#on-event-callback)
    * [isProcessingCommands()](#isProcessingCommands)
    * [startProcessing()](#startProcessing)
    * [stopProcessing(abortCurrent, callback)](#stopProcessing-abortCurrent-callback)
    * [getPendingCommands()](#getPendingsCommands)
    * [clearPendingCommands()](#clearPendingCommands)
    * [getCurrentCommand()](#getCurrentCommand)
    * [abortCurrentCommand()](#abortCurrentCommand)
    * [run(command, expected, callback, processor)](#promise-run-command-expected-callback-processor)
    * [addCommand(command, expected, callback, processor)](#promise-addCommand-command-expected-callback-processor)
    * [read(n, callback)](#promise-read-n-callback)
    * [write(buf, callback)](#promise-write-buffer-callback)
    * [getInBuffer()](#)
    * [clearInBuffer()](#)
    * [getNotifications()](#)
    * [clearNotifications()](#)
    * [addNotification(name, regex, handler)](#)
    * [removeNotification(name)](#)

  * [Command](#command)
  * [Notification](#notification)
* [Events](#events)

## Example

Example


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

        // command timeout
        timeout: 5000
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

        // with expected result 'OK', and callback
        modem.addCommand('AT+FOOO', 'OK', function(success){
            if (success){
                // success is boolean iff the response string matches the second argument
            }
        }).then((success) => {
            // this function should be called before the callback function also provided above
        });

        // consider the next incoming 6 bytes as the wanted response
        modem.addcommand('AT+FOOO', 6).then(function(buffer){

        });

        modem.addCommand('AT+CREG=?', /\+CREG=(.*),(.*)/).then((matches) => {
            // matches contains the response's string matches according to the given regex
        });

        modem.addCommand('AT+FOOO',  function(buffer){
            // complex response detectors are passed the updated response buffer contents whenever there is new data arriving
            var str = buffer.toString();
            if (str.matches(/^\r\nOK/r/n/){
                return 6; // return the byte count the response (these many bytes will be consumed from the buffer)
            }
            return 0; // return 0 if expected response not received yet
        }).then((buffer) => {
            // complex response detectors receive the whole (consumed) buffer as argument
        });


        // add a notification
        modem.addNotification('myEventName', /+CMI=(.*),(.*)/, function(buffer, matches) {
            modem.addCommand("AT+CMR="+matches[1], parseInt(matches[2])).then((buf) => {
                // buf containes my wanted result
            });
        });


        modem.addNotification('shutdown', /SHUTDOWN/, function(){
            modem.close();
        });
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
* `lineRegex`: (default `"^\r\n(.+)\r\n"`) This RegExp is used to detect one-line responses
* `timeout`: (default: `5000`) Command timeout in millisec

#### Promise open (path)

**_path_**

Denotes path to serial port (on linux typically something like `/tty/tty.serialXYZ`, on windows `COM4`)

#### isOpen ()
Facade for https://www.npmjs.com/package/serialport#isopen

#### pause ()
Facade for https://www.npmjs.com/package/serialport#pause

#### close (callback)
Facade for https://www.npmjs.com/package/serialport#close-callback

#### on (event, callback)

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

#### Promise run (command, expected, callback, processor)

If and only if no other command is currently being processed, runs the given command

**_string|buffer|Command command (required)_**

If it is a (Command)[#command], any other parameters are ignored, otherwise the string|buffer is used as command to write to the serial.

**_string|number|regex|function expected (optional, default: `OK`)_**

**_function callback (optional)_**

**_function processor (optional)_**


#### Promise addCommand (command, expected, callback, processor)

Adds the given command to the pending commands list.
The calling semantics are identical to `run(command, expected, callback, processor)`

#### Promise read (n, callback)
Shortcut helper to `run` a command that just reads n bytes.

**_number n (required)_**

Number of bytes to read.

**_function callback(buffer) (required)_**


#### Promise write (buffer, callback)
Shortcut helper to `run` a command that just writes `buffer` to serial and does not wait for a response.

**_Buffer buffer (required)_**

Buffer to write to serial.

**_function callback (required)_**

#### getInBuffer ()
Get contents of serial in buffer.

#### clearInBuffer ()
Clear contents of serial in buffer.

#### getNotifications ()
Get array of registered notifications.

#### clearNotifications ()
Clear deregister all notifications.

#### .addNotification (name, regex, handler)
Register a new notification.

**_string name (required)_**

A string to uniquely identify the notification. Will overwrite any previsouly notifications with the same value.

**_RegExp regex (required)_**

Matching expression that will be looked out for in the buffer to detect any unsolicited incoming data.

**_function handler(Buffer buffer, Array matches) (required)_**

Notification handler that will be called once `regex` matches incoming data. Will be passed the whole matches buffer and corresponding matches as arguments.

#### removeNotification (name)
Unregister notification with given name.


### Command

### Notification


## Events
