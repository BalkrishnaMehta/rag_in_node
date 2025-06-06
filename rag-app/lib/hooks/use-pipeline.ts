import { Pipeline, PretrainedOptions, Tensor } from "@xenova/transformers";
import { useEffect, useState } from "react";
import {
  InitEventData,
  OutgoingEventData,
  RunEventData,
} from "../workers/pipeline";

export type PipeParameters = Parameters<Pipeline["_call"]>;
export type PipeReturnType = Awaited<ReturnType<Pipeline["_call"]>>;
export type PipeFunction = (...args: PipeParameters) => Promise<PipeReturnType>;

/**
 * Hook to build a Transformers.js pipeline function.
 *
 * Similar to `pipeline()`, but runs inference in a separate
 * Web Worker thread and asynchronous logic is
 * abstracted for you.
 *
 * *Important:* `options` must be memoized (if passed),
 * otherwise the hook will continuously rebuild the pipeline.
 */
export function usePipeline(
  task: string,
  model?: string,
  options?: PretrainedOptions
) {
  const [worker, setWorker] = useState<Worker>();
  const [pipe, setPipe] = useState<PipeFunction>();
  const [error, setError] = useState<string | null>(null);
  const [isClient, setIsClient] = useState(false);

  // Check if we're on the client side
  useEffect(() => {
    setIsClient(true);
  }, []);

  // Using `useEffect` + `useState` over `useMemo` because we need a
  // cleanup function and asynchronous initialization
  useEffect(() => {
    if (!isClient) {
      console.log("usePipeline: Not on client side, skipping worker creation");
      return;
    }

    console.log(
      "usePipeline: Initializing worker with task:",
      task,
      "model:",
      model
    );

    try {
      const { progress_callback, ...transferableOptions } = options ?? {};

      const worker = new Worker(
        new URL("../workers/pipeline.ts", import.meta.url),
        {
          type: "module",
        }
      );

      const onMessageReceived = (e: MessageEvent<OutgoingEventData>) => {
        const { type } = e.data;
        console.log("usePipeline: Received message from worker:", type);

        switch (type) {
          case "progress": {
            const { data } = e.data;
            console.log("usePipeline: Progress update:", data);
            progress_callback?.(data);
            break;
          }
          case "ready": {
            console.log("usePipeline: Worker is ready");
            setWorker(worker);
            setError(null);
            break;
          }
        }
      };

      const onError = (error: ErrorEvent) => {
        console.error("usePipeline: Worker error:", error);
        setError(`Worker error: ${error.message}`);
      };

      worker.addEventListener("message", onMessageReceived);
      worker.addEventListener("error", onError);

      console.log("usePipeline: Posting init message to worker");

      worker.postMessage({
        type: "init",
        args: [task as any, model, transferableOptions],
      } satisfies InitEventData);

      return () => {
        console.log("usePipeline: Cleaning up worker");
        worker.removeEventListener("message", onMessageReceived);
        worker.removeEventListener("error", onError);
        worker.terminate();

        setWorker(undefined);
        setError(null);
      };
    } catch (err) {
      console.error("usePipeline: Error creating worker:", err);
      setError(err instanceof Error ? err.message : "Failed to create worker");
    }
  }, [task, model, options, isClient]);

  // Using `useEffect` + `useState` over `useMemo` because we need a
  // cleanup function
  useEffect(() => {
    if (!worker) {
      console.log("usePipeline: No worker available for pipe creation");
      return;
    }

    console.log("usePipeline: Creating pipe function");

    // ID to sync return values between multiple ongoing pipe executions
    let currentId = 0;

    const callbacks = new Map<number, (data: PipeReturnType) => void>();

    const onMessageReceived = (e: MessageEvent<OutgoingEventData>) => {
      console.log("usePipeline: Pipe received message:", e.data.type);

      switch (e.data.type) {
        case "result":
          const { id, data: serializedData } = e.data;
          console.log("usePipeline: Received result for id:", id);

          try {
            const { type, data, dims } = serializedData;
            const output = new Tensor(type, data, dims);
            const callback = callbacks.get(id);

            if (!callback) {
              throw new Error(`Missing callback for pipe execution id: ${id}`);
            }

            callback(output);
            callbacks.delete(id);
          } catch (err) {
            console.error("usePipeline: Error processing result:", err);
          }
          break;
      }
    };

    const onError = (error: ErrorEvent) => {
      console.error("usePipeline: Pipe worker error:", error);
    };

    worker.addEventListener("message", onMessageReceived);
    worker.addEventListener("error", onError);

    const pipe: PipeFunction = (...args) => {
      console.log("usePipeline: Pipe called with args:", args);

      if (!worker) {
        throw new Error("Worker unavailable");
      }

      const id = currentId++;

      return new Promise<PipeReturnType>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          callbacks.delete(id);
          reject(new Error("Pipeline execution timeout"));
        }, 30000); // 30 second timeout

        callbacks.set(id, (data) => {
          clearTimeout(timeoutId);
          resolve(data);
        });

        try {
          console.log("usePipeline: Posting run message with id:", id);
          worker.postMessage({ type: "run", id, args } satisfies RunEventData);
        } catch (err) {
          clearTimeout(timeoutId);
          callbacks.delete(id);
          reject(err);
        }
      });
    };

    setPipe(() => pipe);

    return () => {
      console.log("usePipeline: Cleaning up pipe");
      worker?.removeEventListener("message", onMessageReceived);
      worker?.removeEventListener("error", onError);
      setPipe(undefined);
    };
  }, [worker]);

  // Log current state
  useEffect(() => {
    console.log("usePipeline state:", {
      isClient,
      hasWorker: !!worker,
      hasPipe: !!pipe,
      error,
    });
  }, [isClient, worker, pipe, error]);

  return pipe;
}
