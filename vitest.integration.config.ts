import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts'],
    globalSetup: ['test/integration/global-setup.ts'],
    // ทุกไฟล์ใช้ฐานข้อมูลเดียวกันและล้างตารางระหว่างเทส จึงต้องรันทีละไฟล์
    fileParallelism: false,
  },
});
