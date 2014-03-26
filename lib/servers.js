#!/usr/bin/env node
/* vim: set syntax=javascript ts=8 sts=8 sw=8 noet: */

var mod_assert = require('assert-plus');

var mod_verror = require('verror');


function
Server(mgr, server_uuid, hostname, dcname, version)
{
	var self = this;

	mod_assert.object(mgr, 'mgr');
	mod_assert.string(server_uuid, 'server_uuid');
	mod_assert.string(hostname, 'hostname');
	mod_assert.string(dcname, 'dcname');
	mod_assert.string(version, 'version');

	self.s_mgr = mgr;
	self.s_log = mgr.sm_log.child({
		server: server_uuid,
		hostname_: hostname
	});

	self.s_uuid = server_uuid;
	self.s_hostname = hostname;
	self.s_datacenter = dcname;
	self.s_version = version;

	self.s_lastseen = Date.now();

	self.s_shed = null;
	self.s_connected = false;
	self.s_configured = false;
}

Server.prototype.configured = function
configured(val)
{
	if (val === true || val === false)
		this.s_configured = val;
	return (this.s_configured);
};

Server.prototype.connected = function
connected()
{
	return (this.s_connected);
};

Server.prototype.datacenter = function
datacenter()
{
	return (this.s_datacenter);
};

Server.prototype.uuid = function
uuid()
{
	return (this.s_uuid);
};

Server.prototype.post = function
post(payload)
{
	var self = this;

	mod_assert.ok(self.s_connected, 'post() when not connected');

	self.s_shed.send(JSON.stringify(payload));
};

Server.prototype.accept = function
accept(shed)
{
	var self = this;

	if (self.s_shed) {
		var old_shed = self.s_shed;

		self.s_log.info('replacing connection');

		old_shed.removeAllListeners();
		/*
		 * Gracefully end, but if we're still open in 10 seconds
		 * destroy the socket:
		 */
		old_shed.end('replaced connection');
		setTimeout(function () {
			try {
				old_shed.destroy();
			} catch (__) {
			}
		}, 10 * 1000);
	}

	self.s_shed = shed;
	self.s_connected = true;
	/*
	 * Once we accept a new connection, replacement or otherwise,
	 * we should re-send configuration:
	 */
	self.s_configured = false;

	self.s_shed.on('end', function (code, reason) {
		self.s_connected = false;
		self.s_configured = false;
		self.s_shed = null;
		self.s_log.info({
			code: code,
			reason: reason
		}, 'client connection closed');
	});

	self.s_shed.on('error', function (err) {
		self.s_log.error({
			err: err
		}, 'client connection error');
	});

	self.s_shed.on('text', function (text) {
		var obj;
		try {
			obj = JSON.parse(text);
		} catch (ex) {
			self.s_log.error({
				err: ex
			}, 'invalid JSON object from actor; disconnecting');
			var old_shed = self.s_shed;
			old_shed.removeAllListeners();
			self.s_shed = null;
			self.s_connected = false;
			self.s_configured = false;
			try {
				old_shed.destroy();
			} catch (__) {
			}
		}

		self.s_log.trace({
			obj: obj
		}, 'received from actor');
	});

	self.post({
		type: 'identify_ok'
	});

	self.post({
		type: 'enable_heartbeat',
		timeout: 8000
	});
};

Server.prototype.execute = function
execute(args, env, script, callback)
{
	var self = this;

	var params = {
	};
	var opts = {
	};
	self.s_mgr.sm_cnapi.commandExecute(self.s_uuid, script, params, opts,
	    function (err, res) {
		if (err) {
			callback(new mod_verror.VError(err, 'could not ' +
			    'execute command on server %s', self.s_uuid));
			return;
		}

		callback(null, res);
	});
};


function
ServerManager(log, cnapi)
{
	var self = this;

	mod_assert.object(log, 'log');
	mod_assert.object(cnapi, 'cnapi');

	self.sm_log = log;
	self.sm_cnapi = cnapi;
	self.sm_deployed_version = null;

	self.sm_servers = [];
	self.sm_timer = null;
	self.sm_poll_delay = 10000;

	self._resched(1);
}

ServerManager.prototype.deployed_version = function
deployed_version(ts)
{
	if (ts)
		this.sm_deployed_version = ts;

	return (this.sm_deployed_version);
};

ServerManager.prototype.accept = function
accept(new_shed)
{
	var self = this;

	new_shed.on('text', function (text) {
		var obj;

		try {
			obj = JSON.parse(text);
		} catch (ex) {
			self.sm_log.error({
				err: ex
			}, 'parse error from new client');
			new_shed.removeAllListeners();
			try {
				new_shed.destroy();
			} catch (__)
			{
			}
		}

		if (obj.type === 'identify') {
			new_shed.removeAllListeners('text');

			if (obj.deployed_version !==
			    self.sm_deployed_version) {
				new_shed.send(JSON.stringify({
					type: 'redeploy'
				}));
				return;
			}


			var server = self.lookup(obj.server_uuid);
			if (!server) {
				new_shed.end('unknown server uuid');
				return;
			}

			new_shed.removeAllListeners('error');
			new_shed.removeAllListeners('end');

			server.accept(new_shed);
			return;
		}

		self.sm_log.debug({
			obj: obj
		}, 'pre-identify frame from client');
	});
};

ServerManager.prototype.list = function
list()
{
	var self = this;

	return ([].concat(self.sm_servers));
};

ServerManager.prototype.lookup = function
lookup(server)
{
	var self = this;

	for (var i = 0; i < self.sm_servers.length; i++) {
		var s = self.sm_servers[i];

		if (s.s_uuid === server)
			return (s);
	}

	return (null);
};

ServerManager.prototype._update = function
_update(server_uuid, dcname, hostname, version)
{
	var self = this;

	var s = self.lookup(server_uuid);

	if (!s) {
		s = new Server(self, server_uuid, hostname, dcname, version);
		self.sm_servers.push(s);
	} else {
		s.s_lastseen = Date.now();
	}

	return (s);
};

ServerManager.prototype._resched = function
_resched(ms)
{
	var self = this;

	if (self.sm_timer)
		return;

	self.sm_timer = setTimeout(function () {
		self.sm_timer = null;
		self._cnapi_poll(function () {
			self._resched();
		});
	}, ms || self.sm_poll_delay);
};


ServerManager.prototype._cnapi_poll = function
_cnapi_poll(callback)
{
	var self = this;

	var params = {
		extras: 'sysinfo'
	};
	self.sm_cnapi.listServers(params, function (err, res) {
		if (err) {
			self.sm_log.error({
				err: err
			}, 'could not fetch servers from CNAPI');
			callback(err);
			return;
		}

		for (var i = 0; i < res.length; i++) {
			var server = res[i];

			if (!server.setup)
				continue;

			if (!server.sysinfo) {
				self.s_log.warn({
					server: server.uuid
				}, 'server has no "sysinfo" in CNAPI');
				continue;
			}

			if (!server.datacenter || !server.datacenter.trim()) {
				self.s_log.warn({
					server: server.uuid
				}, 'server has no "datacenter" in CNAPI');
				continue;
			}

			self._update(server.uuid, server.datacenter,
			    server.hostname,
			    server.sysinfo['SDC Version'] || '6.5');
		}

		callback();
	});
};

module.exports = {
	ServerManager: ServerManager
};