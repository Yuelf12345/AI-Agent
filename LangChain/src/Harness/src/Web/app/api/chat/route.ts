import { NextRequest, NextResponse } from "next/server";

const HARNESS_URL = process.env.HARNESS_URL || "http://localhost:3000";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (!body.message && !body.messages) {
      return NextResponse.json({ error: "消息不能为空" }, { status: 400 });
    }

    // 调用 Harness 服务
    const res = await fetch(`${HARNESS_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const error = await res.text();
      return NextResponse.json({ error }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (e) {
    const error = e instanceof Error ? e.message : "服务器错误";
    return NextResponse.json({ error }, { status: 500 });
  }
}