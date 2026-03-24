import { NextRequest, NextResponse } from "next/server";
import { getValidSession, SESSION_COOKIE_NAME } from "@/lib/session";

export async function GET(request: NextRequest) {
    const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value?.trim();

    if (!sessionToken) {
        const response = NextResponse.json({ valid: false }, { status: 401 });
        response.cookies.set(SESSION_COOKIE_NAME, "", {
            httpOnly: true,
            path: "/",
            sameSite: "lax",
            maxAge: 0,
            secure: process.env.NODE_ENV === "production",
        });
        return response;
    }

    try {
        const session = await getValidSession(sessionToken);

        if (session) {
            return NextResponse.json({ valid: true }, { status: 200 });
        } else {
            const response = NextResponse.json({ valid: false }, { status: 401 });
            response.cookies.set(SESSION_COOKIE_NAME, "", {
                httpOnly: true,
                path: "/",
                sameSite: "lax",
                maxAge: 0,
                secure: process.env.NODE_ENV === "production",
            });
            return response;
        }
    } catch (error) {
        console.error("Session verification error:", error);
        const response = NextResponse.json({ valid: false }, { status: 500 });
        response.cookies.set(SESSION_COOKIE_NAME, "", {
            httpOnly: true,
            path: "/",
            sameSite: "lax",
            maxAge: 0,
            secure: process.env.NODE_ENV === "production",
        });
        return response;
    }
}
