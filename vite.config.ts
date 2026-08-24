import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// v2.0.7ff:Vite 代码分割 — 3 个 vendor chunk + 按页面 lazy split
// 1. react-vendor: react / react-dom / react-router-dom
// 2. echarts-vendor: echarts / echarts-for-react(主要大小来源)
// 3. antd-vendor: antd(Modal / Pagination / InputNumber 等)
export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('echarts')) return 'echarts-vendor'
          if (id.includes('antd')) return 'antd-vendor'
          if (id.includes('react') || id.includes('react-router')) return 'react-vendor'
          return undefined
        },
      },
    },
  },
})
