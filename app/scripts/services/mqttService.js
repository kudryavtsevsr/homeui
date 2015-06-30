'use strict';

angular.module('homeuiApp.mqttServiceModule', ['ngResource'])
  .factory('whenMqttReady', function ($q, $rootScope, mqttClient) {
    return function whenMqttReady () {
      var deferred = $q.defer();
      if (mqttClient.isConnected())
        deferred.resolve();
      else {
        var unwatch = $rootScope.$watch(
          function () { return mqttClient.isConnected(); },
          function (newValue) {
            if (!newValue)
              return;
            deferred.resolve();
            unwatch();
          });
      }
      return deferred.promise;
    };
  })

  .factory('topicMatches', function () {
    return function topicMatches(pattern, topic) {
      function match (patternParts, topicParts) {
        if (!patternParts.length)
          return !topicParts.length;
        if (patternParts[0] == "#") {
          if (patternParts.length != 1)
            throw new Error("invalid pattern");
          return true;
        }
        if (!topicParts.length)
          return false;
        if (patternParts[0] != "+" && topicParts[0] != patternParts[0])
          return false;
        return match(patternParts.slice(1), topicParts.slice(1));
      }
      return match(pattern.split("/"), topic.split("/"));
    };
  })

  .factory('mqttClient', function($window, $rootScope, topicMatches) {
    var globalPrefix = '';
    var service = {};
    var client = {};
    var id = '';
    var connected = false;
    var callbackMap = Object.create(null);
    if($window.localStorage['prefix'] === 'true')
      globalPrefix = '/client/' + $window.localStorage['user'];

    service.connect = function(host, port, clientid, user, password) {
      var options = {
        onSuccess: service.onConnect,
        onFailure: service.onFailure
      };

      if(user != undefined && password != undefined) {
        options.userName = user;
        options.password = password;
      }

      id = clientid;
      console.log("Try to connect to MQTT Broker on " + host + ":" + port + " with username " + user + " and clientid " + clientid);

      client = new Paho.MQTT.Client(host, parseInt(port), '/', clientid);
      client.connect(options);

      client.onConnectionLost = service.onConnectionLost;
      client.onMessageDelivered = service.onMessageDelivered;
      client.onMessageArrived = service.onMessageArrived;
    };

    service.getID = function getID () {
      return id;
    };

    service.onConnect = function() {
      console.log("Connected to " + client.host + ":" + client.port + " as '" + client.clientId + "'");
      if(globalPrefix != '') console.log('With globalPrefix: ' + globalPrefix);
      client.subscribe(globalPrefix + "/devices/#");
      //~ client.subscribe(globalPrefix + "/config/#");
      client.subscribe(globalPrefix + "/config/default_dashboard/#");
      client.subscribe(globalPrefix + "/config/rooms/#");
      client.subscribe(globalPrefix + "/config/widgets/#");
      client.subscribe(globalPrefix + "/config/dashboards/#");

      connected = true;
      $rootScope.$digest();
    };

    service.onFailure = function() {
      console.log("Failure to connect to " + client.host + ":" + client.port + " as " + client.clientId);
      connected = false;
      $rootScope.$digest();
    };

    service.publish = function(topic, payload) {
      client.publish(topic, payload, {retain: true});
      console.log('publish-Event sent '+ payload + ' with topic: ' + topic + ' ' + client);
    };

    service.subscribe = function (topic, callback) {
      client.subscribe(globalPrefix + topic, { qos: 2 });
      callbackMap[topic] = (callbackMap[topic] || []).concat([callback]);
    };

    service.onMessage = function(callback) {
      service.callback = callback;
    };

    service.onConnectionLost = function (errorCallback) {
      console.log("Server connection lost: " + errorCallback.errorMessage);
      connected = false;
      callbackMap = Object.create(null);
      $rootScope.$digest();
    };

    service.onMessageDelivered = function(message) {
      console.log("Delivered message: " + JSON.stringify(message));
    };

    service.onMessageArrived = function(message) {
      // console.log("Arrived message: " + message.destinationName + " with " + message.payloadBytes.length + " bytes of payload");
      // console.log("Message: " + String.fromCharCode.apply(null, message.payloadBytes));
      var topic = message.destinationName;
      if (topic.substring(0, globalPrefix.length) == globalPrefix)
        topic = topic.substring(globalPrefix.length);
      Object.keys(callbackMap).sort().forEach(function (pattern) {
        if (!topicMatches(pattern, topic))
          return;
        callbackMap[pattern].forEach(function (callback) {
          callback({
            topic: topic,
            payload: message.payloadString,
            qos: message.qos,
            retained: message.retained
          });
        });
      });
      // FIXME: probably should get rid of the following
      // (use common subscription mechanism implemented above)
      service.callback(message);
      $rootScope.$digest();
    };

    service.send = function(destination, payload, retained, qos) {
      var topic = globalPrefix + destination;
      if (payload == null) {
	payload = new ArrayBuffer();
      }
      var message = new Paho.MQTT.Message(payload);
      message.destinationName = topic;
      message.qos = qos === undefined ? 1 : qos;
      if (retained != undefined) {
	message.retained = retained;
      } else {
	message.retained = true;
      }

      client.send(message);
    };

    service.disconnect = function() {
      client.disconnect();
    };

    service.isConnected = function () {
      return connected;
    };

    return service;
  });
