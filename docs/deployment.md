# Static deployment

Run `npm test` and `npm run build`. The `dist/` directory is the complete site:
HTML, CSS, JavaScript, the license, and synthetic examples. Production needs no
Node.js process, database, API keys, or external JavaScript service.

For the MoQ interop server, serve the directory at `/mlog/`. For example,
include this location in the existing HTTPS server's nginx configuration:

```nginx
location /mlog/ {
    alias /var/www/mlog-visualizer/current/;
    index index.html;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy no-referrer always;
}
```

Keep nginx's normal MIME types enabled so module scripts and workers receive
`text/javascript` or `application/javascript`. The `.mlog` and `.sqlog`
examples can be served as `application/octet-stream`; the browser reads them
as text.

## Release through a devserver

1. Archive `dist/` and copy the archive to an authenticated devserver.
2. From that devserver, use SSH/SCP to transfer it to `fb.mvfst.net`.
3. Extract it into a new release directory, such as
   `/var/www/mlog-visualizer/releases/<commit>/`.
4. Set `/var/www/mlog-visualizer/current` to that release directory.
5. Validate nginx configuration with `nginx -t` before reloading nginx.

Use the host's existing web server and HTTPS configuration. Retain the previous
release directory so changing the symlink provides a simple rollback.

## Verify

- Open the public `/mlog/` URL in a browser.
- Load the sample and upload a real file through the file picker.
- Check filtering, event details, zooming, and trace selection.
- Upload invalid JSON and check that it produces a readable error.
- Inspect network requests: loading a local file should cause no upload.
- Check browser console errors and module MIME types.

The log data stays in browser memory. Server access logs contain asset requests
and the public example download.

## Interop host container

The interop host uses its existing Let's Encrypt certificate. Keep its
automatically rotated files in place and mount `/etc/letsencrypt` read-only.
The viewer listens on TCP 443. Port 80 remains available for certbot's existing
standalone HTTP challenge.

```sh
docker run -d --name mlog-visualizer --restart unless-stopped \
  -p 443:443 \
  -v /var/www/mlog-visualizer:/srv/mlog-visualizer:ro \
  -v /var/www/mlog-visualizer/config:/etc/nginx/conf.d:ro \
  -v /etc/letsencrypt:/etc/letsencrypt:ro \
  nginx:1.28-alpine
```

Copy `deploy/nginx.conf` to `/var/www/mlog-visualizer/config/default.conf`.
Use a relative `current -> releases/<commit>` symlink; mounting the parent
directory lets the running container see release switches. Install
`deploy/reload-certificates.sh` as an executable certbot deploy hook to reload
the viewer after renewal. Validate the configuration before starting or
reloading the container.
