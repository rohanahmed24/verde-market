import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import handler from "serve-handler";

const output = resolve(import.meta.dirname, "../dist");

export function createPreviewServer() {
    if (!existsSync(resolve(output, ".verde-generated"))) {
        throw new Error("The generated site is missing; run npm run build before previewing.");
    }

    return createServer((request, response) => {
        // serve-handler 6 drops the search string during clean-URL and slash
        // redirects. Keep checkout mode, search, and journal topic intact.
        const searchIndex = request.url.indexOf("?");
        const search = searchIndex === -1 ? "" : request.url.slice(searchIndex);
        const writeHead = response.writeHead;
        response.writeHead = function (statusCode, headers) {
            const location = headers?.Location;
            if (statusCode >= 300 && statusCode < 400 && search &&
                location?.startsWith("/") && !location.startsWith("//") && !location.includes("?")) {
                headers = { ...headers, Location: `${location}${search}` };
            }
            return writeHead.call(this, statusCode, headers);
        };

        handler(request, response, {
            public: output,
            cleanUrls: true,
            trailingSlash: false,
            directoryListing: false,
            symlinks: false,
            headers: [{ source: "**", headers: [{ key: "X-Content-Type-Options", value: "nosniff" }] }],
        }).catch((error) => {
            console.error("Preview request failed:", error.message);
            if (!response.headersSent) response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
            response.end("Preview request failed.");
        });
    });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const server = createPreviewServer();
    server.on("error", (error) => {
        console.error(`Cannot start the preview at http://127.0.0.1:4174: ${error.message}`);
        process.exitCode = 1;
    });
    server.listen(4174, "127.0.0.1", () => console.log("Verde preview: http://127.0.0.1:4174"));
}
