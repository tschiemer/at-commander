AT Commander
======================

Promised based AT(tention) command handler for serial ports (typically for use with external modem components and the like).
Features:

- Send simple commands and receive simple responses
- Catch complex responses and preprocess
- Set up notifications / event handlers for unsolicited messages
- Command queue


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
