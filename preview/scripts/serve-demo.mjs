import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const previewRoot = path.resolve(__dirname, '..');
const host = '127.0.0.1';
const port = 4173;

const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.ico': 'image/x-icon'
};

const send = (response, statusCode, body, contentType) => {
    response.writeHead(statusCode, {
        'Content-Type': contentType,
        'Cache-Control': 'no-store'
    });
    response.end(body);
};

const normalizeRequestPath = (urlPath) => {
    const cleanPath = decodeURIComponent((urlPath || '/').split('?')[0]);
    const relativePath = cleanPath === '/' ? '/playground/index.html' : cleanPath;
    const directPath = path.resolve(previewRoot, `.${relativePath}`);
    if (!directPath.startsWith(previewRoot)) {
        return null;
    }
    if (fs.existsSync(directPath) && fs.statSync(directPath).isDirectory()) {
        const indexPath = path.join(directPath, 'index.html');
        return fs.existsSync(indexPath) ? indexPath : null;
    }
    return directPath;
};

const server = http.createServer((request, response) => {
    const resolvedPath = normalizeRequestPath(request.url || '/');
    if (!resolvedPath) {
        send(response, 403, 'Forbidden', 'text/plain; charset=utf-8');
        return;
    }

    fs.readFile(resolvedPath, (error, buffer) => {
        if (error) {
            if (error.code === 'ENOENT') {
                send(response, 404, 'Not found', 'text/plain; charset=utf-8');
                return;
            }
            send(response, 500, String(error), 'text/plain; charset=utf-8');
            return;
        }

        const extension = path.extname(resolvedPath).toLowerCase();
        const contentType = mimeTypes[extension] || 'application/octet-stream';
        send(response, 200, buffer, contentType);
    });
});

server.listen(port, host, () => {
    console.log(`[preview demo] Serving ${previewRoot}`);
    console.log(`[preview demo] Open http://${host}:${port}/`);
});
