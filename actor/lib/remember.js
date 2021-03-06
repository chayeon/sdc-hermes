/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var mod_assert = require('assert-plus');

var CACHE_TTL_HOURS = 4;

/*
 * In order to allow us to scan for new log files frequently, but without
 * wasting cycles continuously re-uploading (or re-hashing, verifying, etc)
 * we implement a simple memoisation cache of files that have been uploaded
 * from the local system to Manta.
 */
function
Remember()
{
	var self = this;

	self.rmb_files = [];

	self._expire();
}

/*
 * Expire old records once a minute.  Attempts to prevent this memoisation
 * cache from growing without bound.
 */
Remember.prototype._expire = function
_expire()
{
	var self = this;

	var now = Date.now();

	for (var i = 0; i < self.rmb_files.length; i++) {
		var f = self.rmb_files[i];

		if (now >= f.f_expire_at) {
			/*
			 * Remove this array element, then wind the walk
			 * back by one element:
			 */
			self.rmb_files.splice(i, 1);
			i--;
		}
	}

	setTimeout(function () {
		self._expire();
	}, 60 * 1000);
};

Remember.prototype._find = function
_find(local_path, manta_path, mtime)
{
	var self = this;

	for (var i = 0; i < self.rmb_files.length; i++) {
		var f = self.rmb_files[i];

		if (f.f_local_path === local_path &&
		    f.f_manta_path === manta_path &&
		    f.f_mtime === mtime) {
			return (f);
		}
	}

	return (null);
};

Remember.prototype.mark_uploaded = function
mark_uploaded(local_path, manta_path, mtime)
{
	var self = this;

	mod_assert.string(local_path, 'local_path');
	mod_assert.string(manta_path, 'manta_path');
	mod_assert.number(mtime, 'mtime');

	var f = self._find(local_path, manta_path, mtime);
	if (f) {
		/*
		 * Refresh record:
		 */
		f.f_expire_at = Date.now() + (CACHE_TTL_HOURS * 3600 * 1000);
		return;
	}

	self.rmb_files.push({
		f_local_path: local_path,
		f_manta_path: manta_path,
		f_mtime: mtime,
		f_expire_at: Date.now() + (CACHE_TTL_HOURS * 3600 * 1000)
	});
};

Remember.prototype.uploaded_already = function
uploaded_already(local_path, manta_path, mtime)
{
	var self = this;

	return (self._find(local_path, manta_path, mtime) !== null);
};

module.exports = {
	Remember: Remember
};

/* vim: set syntax=javascript ts=8 sts=8 sw=8 noet: */
