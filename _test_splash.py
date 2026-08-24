"""启动页粒子动画截图"""
import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path="/root/.cache/ms-playwright/chromium-1223/chrome-linux/chrome", headless=True, args=["--no-sandbox"])
        ctx = await browser.new_context(viewport={"width": 1440, "height": 900}, timezone_id="Asia/Shanghai")
        page = await ctx.new_page()
        # 拦截 data.json 阻止加载,让启动页停留
        async def handle_route(route):
            if 'data.json' in route.request.url:
                await route.abort()
            else:
                await route.continue_()
        await page.route("**/data.json", handle_route)
        await page.goto("http://localhost:5123/premarket", wait_until="domcontentloaded", timeout=10000)
        # 等 2s 截启动页(粒子动画已在跑)
        await page.wait_for_timeout(2000)
        await page.screenshot(path="_shots14/v242_splash.png", full_page=False)
        # 等 3s 再截(看粒子动画)
        await page.wait_for_timeout(3000)
        await page.screenshot(path="_shots14/v242_splash2.png", full_page=False)
        await browser.close()

asyncio.run(main())
