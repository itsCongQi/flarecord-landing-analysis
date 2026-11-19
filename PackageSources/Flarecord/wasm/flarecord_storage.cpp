// Flarecord storage module.
//
// A standalone WASM module that gives the Flarecord EFB app a place to keep files. JavaScript in
// the sim cannot write files; a WASM module can, inside its package's work folder. The app sends
// requests over the Comm Bus and this module answers each one.
//
//   request  FLARECORD_FS_REQ   "<id>\n<op>\n<key>\n<value>"     op: P ping, R read, W write
//   reply    FLARECORD_FS_RES   "<id>\n<status>\n<value>"        status: OK, MISSING, ERR
//
// One file per key: /work/<key>.json. Keys may hold letters, digits, '.', '-' and '_' only, so a
// request can never name a path outside the work folder. Writing an empty value empties the
// file, and an empty file reads back as MISSING.
//
// The app sends one request at a time and waits for the answer, so there is never more than one
// file operation in flight.

#include <MSFS/MSFS.h>
#include <MSFS/MSFS_CommBus.h>
#include <MSFS/MSFS_IO.h>

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static const char* const REQ_EVENT = "FLARECORD_FS_REQ";
static const char* const RES_EVENT = "FLARECORD_FS_RES";
static const char* const MODULE_VERSION = "1.0";

static const int MAX_KEY = 96;
static const int MAX_VALUE = 4 * 1024 * 1024;

struct Job
{
	char id[24];
	char path[160];
	char* buf;
	int len;
};

static void Reply(const char* id, const char* status, const char* value, int valueLen)
{
	const int idLen = (int)strlen(id);
	const int statusLen = (int)strlen(status);
	const int total = idLen + 1 + statusLen + 1 + valueLen;
	char* out = (char*)malloc(total + 1);
	if (!out)
		return;
	char* p = out;
	memcpy(p, id, idLen);
	p += idLen;
	*p++ = '\n';
	memcpy(p, status, statusLen);
	p += statusLen;
	*p++ = '\n';
	if (valueLen > 0)
		memcpy(p, value, valueLen);
	out[total] = 0;
	fsCommBusCall(RES_EVENT, out, total + 1, FsCommBusBroadcast_JS);
	free(out);
}

static void Finish(Job* job, FsIOFile file, const char* status, const char* value, int valueLen)
{
	Reply(job->id, status, value, valueLen);
	if (file != FS_IO_ERROR_FILE)
		fsIOClose(file);
	if (job->buf)
		free(job->buf);
	free(job);
}

// ---- write ----------------------------------------------------------------------------------

static void OnWritten(FsIOFile file, const char* pInBuffer, int byteOffset, int bytesWritten, void* pUserData)
{
	Job* job = (Job*)pUserData;
	const bool ok = !fsIOHasError(file) && bytesWritten == job->len;
	if (!ok)
		fprintf(stderr, "Flarecord storage: write of %s failed (%d of %d bytes, error %u)\n", job->path, bytesWritten, job->len, (unsigned)fsIOGetLastError(file));
	Finish(job, file, ok ? "OK" : "ERR", "", 0);
}

static void OnOpenedForWrite(FsIOFile file, void* pUserData)
{
	Job* job = (Job*)pUserData;
	if (file == FS_IO_ERROR_FILE || fsIOHasError(file))
	{
		fprintf(stderr, "Flarecord storage: could not open %s for writing (error %u)\n", job->path, (unsigned)fsIOGetLastError(file));
		Finish(job, file, "ERR", "", 0);
		return;
	}
	if (job->len == 0)
	{
		// Opening with TRUNC already emptied the file.
		Finish(job, file, "OK", "", 0);
		return;
	}
	if (fsIOWrite(file, job->buf, 0, job->len, OnWritten, job) != FsIOErr_Success)
		Finish(job, file, "ERR", "", 0);
}

// ---- read -----------------------------------------------------------------------------------

static void OnRead(FsIOFile file, char* outBuffer, int byteOffset, int bytesRead, void* pUserData)
{
	Job* job = (Job*)pUserData;
	if (fsIOHasError(file) || bytesRead < 0)
		Finish(job, file, "ERR", "", 0);
	else if (bytesRead == 0)
		Finish(job, file, "MISSING", "", 0);
	else
		Finish(job, file, "OK", outBuffer, bytesRead);
}

static void OnOpenedForRead(FsIOFile file, void* pUserData)
{
	Job* job = (Job*)pUserData;
	if (file == FS_IO_ERROR_FILE || fsIOHasError(file))
	{
		const bool missing = file != FS_IO_ERROR_FILE && fsIOGetLastError(file) == FsIOErr_FileNotFound;
		Finish(job, file, missing ? "MISSING" : "ERR", "", 0);
		return;
	}
	const unsigned long long size = fsIOGetFileSize(file);
	if (size == 0)
	{
		Finish(job, file, "MISSING", "", 0);
		return;
	}
	if (size > (unsigned long long)MAX_VALUE)
	{
		Finish(job, file, "ERR", "", 0);
		return;
	}
	job->len = (int)size;
	job->buf = (char*)malloc(job->len + 1);
	if (!job->buf || fsIORead(file, job->buf, 0, job->len, OnRead, job) != FsIOErr_Success)
		Finish(job, file, "ERR", "", 0);
}

// ---- requests -------------------------------------------------------------------------------

static bool BuildPath(const char* key, int keyLen, char* out, int outSize)
{
	if (keyLen <= 0 || keyLen > MAX_KEY)
		return false;
	for (int i = 0; i < keyLen; i++)
	{
		const char c = key[i];
		const bool ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '.' || c == '-' || c == '_';
		if (!ok)
			return false;
		if (c == '.' && (i == 0 || key[i - 1] == '.'))
			return false;
	}
	return snprintf(out, outSize, "/work/%.*s.json", keyLen, key) < outSize;
}

static void OnRequest(const char* buf, unsigned int bufSize, void* ctx)
{
	if (!buf)
		return;
	// The size may or may not count a terminating zero: stop at the first one.
	int n = 0;
	while ((unsigned int)n < bufSize && buf[n] != 0)
		n++;

	// "<id>\n<op>\n<key>\n<value>"
	int cut[3];
	int found = 0;
	for (int i = 0; i < n && found < 3; i++)
		if (buf[i] == '\n')
			cut[found++] = i;
	if (found < 3 || cut[0] <= 0 || cut[0] >= 24 || cut[1] != cut[0] + 2)
		return;

	Job* job = (Job*)calloc(1, sizeof(Job));
	if (!job)
		return;
	memcpy(job->id, buf, cut[0]);
	const char op = buf[cut[0] + 1];
	const char* key = buf + cut[1] + 1;
	const int keyLen = cut[2] - cut[1] - 1;
	const char* value = buf + cut[2] + 1;
	const int valueLen = n - cut[2] - 1;

	if (op == 'P')
	{
		Finish(job, FS_IO_ERROR_FILE, "OK", MODULE_VERSION, (int)strlen(MODULE_VERSION));
		return;
	}
	if (!BuildPath(key, keyLen, job->path, sizeof(job->path)))
	{
		Finish(job, FS_IO_ERROR_FILE, "ERR", "", 0);
		return;
	}
	if (op == 'R')
	{
		if (fsIOOpen(job->path, FsIOOpenFlag_RDONLY, OnOpenedForRead, job) == FS_IO_ERROR_FILE)
			Finish(job, FS_IO_ERROR_FILE, "MISSING", "", 0);
		return;
	}
	if (op == 'W' && valueLen <= MAX_VALUE)
	{
		job->len = valueLen;
		if (valueLen > 0)
		{
			job->buf = (char*)malloc(valueLen);
			if (!job->buf)
			{
				Finish(job, FS_IO_ERROR_FILE, "ERR", "", 0);
				return;
			}
			memcpy(job->buf, value, valueLen);
		}
		if (fsIOOpen(job->path, FsIOOpenFlag_WRONLY | FsIOOpenFlag_CREAT | FsIOOpenFlag_TRUNC, OnOpenedForWrite, job) == FS_IO_ERROR_FILE)
			Finish(job, FS_IO_ERROR_FILE, "ERR", "", 0);
		return;
	}
	Finish(job, FS_IO_ERROR_FILE, "ERR", "", 0);
}

extern "C" MSFS_CALLBACK void module_init(void)
{
	if (!fsCommBusRegister(REQ_EVENT, OnRequest, nullptr))
		fprintf(stderr, "Flarecord storage: could not register on the Comm Bus\n");
}

extern "C" MSFS_CALLBACK void module_deinit(void)
{
	fsCommBusUnregister(REQ_EVENT, OnRequest);
}
