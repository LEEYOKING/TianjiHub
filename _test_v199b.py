"""v1.9.9 验证 - 用 5090"""
import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path="/root/.cache/ms-playwright/chromium-1223/chrome-linux/chrome", headless=True, args=["--no-sandbox"])
        ctx = await browser.new_context(viewport={"width": 1440, "height": 900})
        page = await ctx.new_page()
        await page.goto("http://localhost:5090/overview", wait_until="networkidle", timeout=30000)
        await page.wait_for_timeout(3500)
        await page.screenshot(path="_shots14/v199_overview.png", full_page=False)
        print("  ✓ shot")
        await browser.close()

asyncio.run(main())
