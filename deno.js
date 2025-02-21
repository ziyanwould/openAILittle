/*
 * @Author: 刘家荣 14731753+liujiarong2@user.noreply.gitee.com
 * @Date: 2025-02-19 15:57:29
 * @LastEditors: 刘家荣 14731753+liujiarong2@user.noreply.gitee.com
 * @LastEditTime: 2025-02-21 10:57:59
 * @FilePath: /openAILittle/deno.js
 * @Description: 这
 * https://dash.deno.com/playground/proud-kingfisher-80
 * 用于受限于AI国内渠道无法访问的代理
 */

import { serve } from "https://deno.land/std/http/server.ts";
serve(async (request) => {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const parts = pathname.slice(1).split("/");
    if (
        pathname === "/" ||
        pathname === "/index.html" ||
        pathname === "/robots.txt" ||
        parts.length < 1
    ) {
        return new Response("Not Found", { status: 404 });
    }
    const domain = parts[0];
    const rest = "/" + parts.slice(1).join("/");
    const targetUrl = `https://${domain}${rest}`;
    try {
        const headers = new Headers();
        const allowedHeaders = [
            "accept",
            "content-type",
            "authorization",
            "x-api-key",
            "anthropic-version",
        ];
        for (const [key, value] of request.headers.entries()) {
            if (allowedHeaders.includes(key.toLowerCase())) {
                headers.set(key, value);
            }
        }
        const response = await fetch(targetUrl, {
            method: request.method,
            headers: headers,
            body: request.body,
        });
        const responseHeaders = new Headers(response.headers);
        responseHeaders.set("X-Content-Type-Options", "nosniff");
        responseHeaders.set("X-Frame-Options", "DENY");
        responseHeaders.set("Referrer-Policy", "no-referrer");
        return new Response(response.body, {
            status: response.status,
            headers: responseHeaders,
        });
    } catch (error) {
        return new Response("Internal Server Error", { status: 500 });
    }
});
