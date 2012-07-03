
/**
 * Module dependencies.
 */

var express = require('express')
  , routes = require('./routes')
  , io
  , files = {} // Holds info on files currently being uploaded.
  , fs = require('fs')
  , exec = require('child_process').exec
  , models = require('./models')
  , mongoose = require('mongoose')
  , util = require('util');

var app = module.exports = express.createServer();

/* 
 * Configuration
 */

app.configure(function(){
  app.set('views', __dirname + '/views');
  app.set('view engine', 'jade');
  app.use(express.bodyParser());
  app.use(express.methodOverride());
  app.use(app.router);
  app.use(express.static(__dirname + '/public'));
});

app.configure('development', function(){
  app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));
  app.set('db-uri', 'mongodb://localhost/media-server');
});

app.configure('production', function(){
  app.use(express.errorHandler());
});

/*
 * Database models
 */ 

models.defineModels(mongoose, function() {
  app.User = User = mongoose.model('User');
  app.Movie = Movie = mongoose.model('Movie');
  db = mongoose.connect(app.set('db-uri'));
});

/*
 * Socket.io events
 */

// Initialize socket.io.
io = require('socket.io').listen(app);

// Set io connection events.
io.sockets.on('connection', function (socket) {
  
  // Start uploading process. @param data contains the variables 
  // passed through from the html file.
  socket.on('start', function (data) { 
    var name = data['name'];
    var size = data['size'];
    // Check if file already exists.
    var Movie = mongoose.model('Movie');
    Movie
      .where({ originalFileName: name, size: size })
      .exec(function(err, results) {
        console.log('********');
        console.log(results);
        if (results.length === 0) {
          // Create new database record.
          var date = new Date();
          var fileName = date.getTime();var movie = new app.Movie({
            name: data['name'],
            machineFileName: fileName,
            originalFileName: name,
            size: data['size']
          });
          movie.save(function(error, data) {});
          console.log(movie);
        }
        else {
          // Use existing record.
        }
      });
    
    //Create a new Entry in The Files Variable.
    files[name] = {  
      fileSize: data['size'],
      data: '',
      downloaded: 0
    };
    var place = 0;
    try {
      // Check if file is already present on server.
      var stat = fs.statSync('temp/' +  name);
      if (stat.isFile()) {
        // Update file information with size of already uploaded portion of file.
        files[name]['downloaded'] = stat.size;
        // Set starting place for continuation of uploading.
        place = stat.size / 524288;
      }
    }
    catch (er) {
      // No file present? Must be a new upload.
    } 
    fs.open("temp/" + name, "a", 0755, function(err, fd) {
      if (err) {
         console.log(err);
      }
      else {
        // Store file handler so can be written to later.
        files[name]['handler'] = fd; 
        // Fetch file data from client. 
        socket.emit('moreData', { 
          'place': place, 
          percent: 0 
        });
      }
    });
  });
  
  // Upload
  socket.on('upload', function (data) {
    var name = data['name'];
    files[name]['downloaded'] += data['data'].length;
    // Add data to data buffer.
    files[name]['data'] += data['data'];
    
    if (files[name]['downloaded'] == files[name]['fileSize'])  {
      // File is fully uploaded.
      fs.write(files[name]['handler'], files[name]['data'], null, 'binary', function(err, written) {
        var input = fs.createReadStream("temp/" + name);
        var output = fs.createWriteStream("static/files/" + name);
        util.pump(input, output, function(){
          // Delete temp media file.
          fs.unlink("temp/" + name, function () { 
            // Move file completed.  Can now generate thumbnail.
            exec("ffmpeg -i static/files/" + name  + " -ss 01:30 -r 1 -an -vframes 1 -f mjpeg static/files/" + name  + ".jpg", function(err) {
              if (err) {
                console.log('Error creating thumbnail: ' + err.message);
              }
              else {
                console.log('Video thumbnail created.');
                // Send upload completed response to client.
                socket.emit('done', {'image' : 'files/' + name + '.jpg'});
              }
           });
          });
        });
      });
    }
    else if (files[name]['data'].length > 10485760) { 
      // Data Buffer is full (has reached 10MB).
      fs.write(files[name]['handler'], files[name]['data'], null, 'binary', function(err, written) {
        //Reset The Buffer
        files[name]['data'] = ""; 
        // Get current upload position.
        var place = files[name]['downloaded'] / 524288;
        // Get current percentage upload completed.
        var percent = (files[name]['downloaded'] / files[name]['fileSize']) * 100;
        // Send request to client for more file data.
        socket.emit('moreData', { 
          'place': place, 
          'percent':  percent 
        });
      });
    }
    else {
      // Data buffer is not full.
      // Get current upload position.
      var place = files[name]['downloaded'] / 524288;
      // Get current percentage upload completed.
      var percent = (files[name]['downloaded'] / files[name]['fileSize']) * 100;
      // Send request to client for more file data.
      socket.emit('moreData', { 
        'place': place, 
        'percent': percent
      });
    }
  });
});

/*
 * Routes
 */ 

app.get('/', routes.index);

app.listen(3000, function(){
  console.log("Express server listening on port %d in %s mode", app.address().port, app.settings.env);
});
