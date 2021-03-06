/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var mod_fs = require('fs');
var mod_crypto = require('crypto');

var mod_assert = require('assert-plus');
var mod_bunyan = require('bunyan');
var mod_jsprim = require('jsprim');
var mod_once = require('once');

function
request_id()
{
	return (Math.floor(Math.random() * 0xffffffff).toString(16));
}

function
hash_file(path, callback)
{
	var hash = mod_crypto.createHash('sha1');
	var fin = mod_fs.createReadStream(path);

	callback = mod_once(callback);

	fin.on('readable', function () {
		var buf;
		while (!!(buf = fin.read())) {
			hash.update(buf);
		}
	});
	fin.on('end', function () {
		callback(null, hash.digest('hex'));
	});
	fin.on('error', callback);
}

function
create_logger(global_state, app_name)
{
	mod_assert.ok(!global_state.gs_ringbuf && !global_state.gs_log);

	global_state.gs_log = mod_bunyan.createLogger({
		name: app_name,
		serializers: mod_bunyan.stdSerializers,
		level: process.env.LOG_LEVEL || mod_bunyan.INFO
	});
}

function
parse_date(date_str)
{
	var dt;
	try {
		/*
		 * Attempt to parse the date:
		 */
		dt = mod_jsprim.parseDateTime(date_str);
		/*
		 * If it's valid, return it:
		 */
		if (!isNaN(dt.valueOf()))
			return (dt);
	} catch (ex) {
	}
	return (null);
}

module.exports = {
	request_id: request_id,
	hash_file: hash_file,
	create_logger: create_logger,
	parse_date: parse_date
};

/* vim: set syntax=javascript ts=8 sts=8 sw=8 noet: */
