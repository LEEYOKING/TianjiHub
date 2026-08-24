"""v2.3 盘前决策仪表盘截图"""
import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path="/root/.cache/ms-playwright/chromium-1223/chrome-linux/chrome", headless=True, args=["--no-sandbox"])
        ctx = await browser.new_context(viewport={"width": 1440, "height": 900}, timezone_id="Asia/Shanghai")
        page = await ctx.new_page()
        await page.goto("http://localhost:5124/overview", wait_until="domcontentloaded", timeout=30000)
        await page.wait_for_timeout(20000)
        await page.screenshot(path="_shots14/v230_premarket.png", full_page=False)
        # full_page
        await page.screenshot(path="_shots14/v230_premarket_full.png", full_page=True)
        await browser.close()

asyncio.run(main())
