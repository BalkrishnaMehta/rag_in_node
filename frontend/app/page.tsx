"use client";

import Chat from "@/components/layouts/Chat";
import File from "@/components/layouts/File";
import List from "@/components/layouts/List";

export default function Index() {
  return (
    <div className="w-full flex flex-col items-center">
      <div className="flex flex-col gap-14 max-w-4xl px-3 py-16 lg:py-24 text-foreground">
        <div className="flex flex-col items-center">
          <h1 className="sr-only">Supabase and Next.js Starter Template</h1>
          <p className="text-3xl lg:text-4xl !leading-tight mx-auto max-w-xl text-center my-12">
            Chat with your files using <strong>Supabase</strong> and{" "}
            <strong>Next.js</strong>
          </p>
          <File />
          <List />
        </div>
        <Chat />
      </div>
    </div>
  );
}
