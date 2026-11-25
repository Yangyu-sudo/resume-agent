import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * 版本库的读写语义：原始简历 + 多个优化版，PDF 挂到最近的优化版上。
 * 用临时目录做 DATA_DIR，避免污染仓库里的 data/。
 */
let store: typeof import("../server/src/resumes");

beforeAll(async () => {
  process.env.RESUME_DATA_DIR = mkdtempSync(join(tmpdir(), "resume-agent-"));
  store = await import("../server/src/resumes");
});

describe("简历版本库", () => {
  it("登记原始简历并生成可下载地址", () => {
    const original = store.addOriginal("conv-1", {
      path: "D:/ws/uploads/abc.pdf",
      fileName: "张晨-简历.pdf",
      chars: 640,
    });
    expect(original.kind).toBe("original");

    const versions = store.publicVersions("conv-1");
    expect(versions).toHaveLength(1);
    expect(versions[0]?.label).toBe("原始简历");
    expect(versions[0]?.downloadUrl).toContain("/api/uploads/");
  });

  it("优化版按顺序编号，PDF 依次挂到最近的未挂载版本", () => {
    store.addOptimized("conv-1", { path: "D:/ws/outputs/a.md", fileName: "a.md", chars: 900 });
    store.addOptimized("conv-1", { path: "D:/ws/outputs/b.md", fileName: "b.md", chars: 950 });
    store.attachPdf("conv-1", "D:/ws/outputs/b.pdf");
    store.attachPdf("conv-1", "D:/ws/outputs/a.pdf");

    const versions = store.publicVersions("conv-1").filter((item) => item.kind === "optimized");
    expect(versions.map((item) => item.label)).toEqual(["优化版 v1", "优化版 v2"]);
    expect(versions[0]?.pdfUrl).toContain("a.pdf");
    expect(versions[1]?.pdfUrl).toContain("b.pdf");
  });

  it("会话之间互不影响", () => {
    expect(store.publicVersions("conv-2")).toEqual([]);
  });

  it("扫描件标记会透传给前端", () => {
    store.addOriginal("conv-3", {
      path: "D:/ws/uploads/scan.pdf",
      fileName: "scan.pdf",
      chars: 0,
      needsOcr: true,
    });
    expect(store.publicVersions("conv-3")[0]?.needsOcr).toBe(true);
  });
});
