import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'TokenScope — Coding Agent 成本监控',
  description: '看清每一枚 Token 的去向。本地分析 Codex 与 Claude Code 会话，发现重复读取、轮询空转和上下文压缩循环。',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
