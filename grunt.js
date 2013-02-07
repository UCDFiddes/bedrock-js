module.exports = function(grunt) {

  // Project configuration.
  grunt.initConfig({
    min: {
      all: {
        src: [
          'lib/underscore.js',
          'lib/q.js',

          'src/connection.js',
          'src/message.js',
          'src/rpc.js',
          'src/pubsub.js'
        ],
        dest: 'build/bedrock.js'
      }
    },
    concat: {
      all: {
        src: ['lib/msgpack.js', 'build/bedrock.js'],
        dest: 'build/bedrock.js'
      }
    },
    watch: {
      js: {
        files: 'src/*.js',
        tasks: 'min concat'
      }
    }
  });

  grunt.registerTask('default', 'min concat watch:js');
};