import { drizzle, DrizzleD1Database } from "drizzle-orm/d1";
import { Elysia } from "elysia";
import 'reflect-metadata';
import Container from "typedi";
import type { Env } from "./db/db";
import * as schema from './db/schema';
import { app } from "./server";
import { friendCrontab } from "./services/friends";
import { rssCrontab } from "./services/rss";
import { CacheImpl } from "./utils/cache";
import { dbToken, envToken } from "./utils/di";
export type DB = DrizzleD1Database<typeof import("./db/schema")>

export default {
    async fetch(
        request: Request,
        env: Env,
    ): Promise<Response> {
        const db = drizzle(env.DB, { schema: schema })
        Container.set(envToken, env)
        Container.set(dbToken, db)

        const exist = Container.has("cache")
        if (!exist) {
            Container.set("cache", new CacheImpl());
            Container.set("server.config", new CacheImpl("server.config"));
            Container.set("client.config", new CacheImpl("client.config"));
        } else {
            // 偶尔检查缓存过期情况 - 对于低频更新的博客，10%概率检查缓存
            if (Math.random() < 0.1) {
                try {
                    const publicCache = Container.get<CacheImpl>("cache");
                    // 6小时缓存过期时间，适合更频繁更新的博客
                    await publicCache.checkAndExpireCache(6);
                } catch (e) {
                    console.error("检查缓存过期时出错:", e);
                }
            }
        }

        return await new Elysia({ aot: false })
            .use(app())
            .handle(request)
    },
    async scheduled(
        _controller: ScheduledController | null,
        env: Env,
        ctx: ExecutionContext
    ) {
        const db = drizzle(env.DB, { schema: schema })
        Container.set(envToken, env)
        Container.set(dbToken, db)

        const exist = Container.has("cache")
        if (!exist) {
            Container.set("cache", new CacheImpl());
            Container.set("server.config", new CacheImpl("server.config"));
            Container.set("client.config", new CacheImpl("client.config"));
        } else {
            // 在计划任务中始终检查并清理过期缓存
            try {
                const publicCache = Container.get<CacheImpl>("cache");
                await publicCache.checkAndExpireCache(6); // 6小时缓存过期
            } catch (e) {
                console.error("计划任务中检查缓存过期时出错:", e);
            }
        }

        await friendCrontab(env, ctx)
        await rssCrontab(env)
    },
}
