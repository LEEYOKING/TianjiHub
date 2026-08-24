import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            executable_path='/root/.cache/ms-playwright/chromium-1223/chrome-linux/chrome',
            args=['--no-sandbox', '--disable-dev-shm-usage']
        )
        ctx = await browser.new_context(viewport={'width': 1920, 'height': 1080}, device_scale_factor=1)
        page = await ctx.new_page()
        page.on('pageerror', lambda e: print('PAGEERR:', str(e)[:200]))
        page.on('console', lambda m: print('CONSOLE:', m.type, str(m.text)[:200]) if m.type in ('error',) else None)

        # overview
        await page.goto('http://localhost:4312/', wait_until='networkidle')
        await page.wait_for_timeout(10000)
        await page.screenshot(path='/workspace/fupan/_shots13/v17_overview.png', full_page=True)
        print('overview saved')

        # sector
        await page.goto('http://localhost:4312/sector', wait_until='networkidle')
        await page.wait_for_timeout(2000)
        await page.screenshot(path='/workspace/fupan/_shots13/v17_sector.png', full_page=True)
        print('sector saved')

        # sector 重点:行业主力净流入
        await page.goto('http://localhost:4312/sector', wait_until='networkidle')
        await page.wait_for_timeout(2000)
        # 点行业主力净流入 TOP15 表头的"主力净流入"列切排序
        # 截图让它能滚动
        await page.evaluate("window.scrollTo(0, 700)")
        await page.wait_for_timeout(500)
        await page.screenshot(path='/workspace/fupan/_shots13/v17_sector_netflow.png', full_page=False)
        print('sector netflow saved')

        # sidebar
        await page.goto('http://localhost:4312/overview', wait_until='networkidle')
        await page.wait_for_timeout(2000)
        await page.screenshot(path='/workspace/fupan/_shots13/v17_sidebar.png', clip={'x': 0, 'y': 0, 'width': 280, 'height': 1080})
        print('sidebar saved')

        # limitup
        await page.goto('http://localhost:4312/limit-up', wait_until='networkidle')
        await page.wait_for_timeout(2000)
        await page.screenshot(path='/workspace/fupan/_shots13/v17_limitup.png', full_page=True)
        print('limitup saved')

        # dt
        await page.goto('http://localhost:4312/dragon-tiger', wait_until='networkidle')
        await page.wait_for_timeout(2000)
        await page.screenshot(path='/workspace/fupan/_shots13/v17_dt.png', full_page=True)
        print('dt saved')

        # surgery
        await page.goto('http://localhost:4312/surgery', wait_until='networkidle')
        await page.wait_for_timeout(2000)
        await page.screenshot(path='/workspace/fupan/_shots13/v17_surgery.png', full_page=True)
        print('surgery saved')

        await browser.close()

asyncio.run(main())
