"use client";

// =====================================================================
// Interactive comment section for the weekly summary post.
//
// Because parent & student logins are SHARED per class, we cannot infer
// "who" is commenting from the session alone — so the composer always
// asks for a name first. That name is stored as `comments.author_name`
// (free text) so the teacher can tell who actually wrote each comment.
//
// Reactions are emoji taps that increment a counter in `comments.reactions`
// (jsonb), applied through the `toggle_comment_reaction` RPC so a shared
// login can never edit someone else's comment text — only bump a count.
// =====================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CommentRow, UserRole } from "@/lib/types";

const REACTION_EMOJIS = ["👍", "❤️", "🎉", "👏", "😮"];
const NAME_STORAGE_KEY = "class-emulation-comment-author-name";
const COMMENT_PAGE_SIZE = 30;

interface CommentSectionProps {
  classId: string;
  currentUserId: string;
  currentUserRole: UserRole;
}

export function CommentSection({ classId, currentUserId, currentUserRole }: CommentSectionProps) {
  const supabase = useMemo(() => createClient(), []);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [hasMoreComments, setHasMoreComments] = useState(true);
  const [isLoadingMoreComments, setIsLoadingMoreComments] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [authorName, setAuthorName] = useState("");
  const [content, setContent] = useState("");
  const [isPosting, setIsPosting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const commentsRef = useRef<CommentRow[]>([]);
  const mountedRef = useRef(false);
  const commentsLoadSequence = useRef(0);

  const loadComments = useCallback(async (page: "latest" | "older" = "latest") => {
    const requestSequence = ++commentsLoadSequence.current;
    const cursor = page === "older" ? commentsRef.current[commentsRef.current.length - 1] : null;
    if (page === "older" && !cursor) return;
    if (page === "older") setIsLoadingMoreComments(true);

    let query = supabase
      .from("comments")
      .select("*")
      .eq("class_id", classId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(COMMENT_PAGE_SIZE);
    if (cursor) {
      query = query.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`);
    }

    let result: Awaited<typeof query>;
    try {
      result = await query;
    } catch {
      if (mountedRef.current && requestSequence === commentsLoadSequence.current) {
        setErrorMessage("Không tải được bình luận. Hãy kiểm tra kết nối rồi thử lại.");
        setIsLoading(false);
        setIsLoadingMoreComments(false);
      }
      return;
    }
    const { data, error } = result;
    if (!mountedRef.current) return;
    if (error) {
      if (requestSequence === commentsLoadSequence.current) {
        setErrorMessage("Không tải được bình luận. Hãy kiểm tra kết nối rồi thử lại.");
        setIsLoading(false);
        setIsLoadingMoreComments(false);
      }
      return;
    }
    if (requestSequence !== commentsLoadSequence.current) {
      if (page === "older") setIsLoadingMoreComments(false);
      return;
    }
    if (error || !data) {
      setIsLoading(false);
      setIsLoadingMoreComments(false);
      return;
    }

    const rows = data as CommentRow[];
    setComments((current) => {
      const currentIds = new Set(current.map((comment) => comment.id));
      const rowIds = new Set(rows.map((comment) => comment.id));
      const merged = page === "older"
        ? [...current, ...rows.filter((row) => !currentIds.has(row.id))]
        : [...rows, ...current.filter((comment) => !rowIds.has(comment.id))];
      merged.sort((first, second) => {
        const dateOrder = new Date(second.created_at).getTime() - new Date(first.created_at).getTime();
        return dateOrder || second.id.localeCompare(first.id);
      });
      commentsRef.current = merged;
      return merged;
    });
    setHasMoreComments(rows.length === COMMENT_PAGE_SIZE);
    setIsLoading(false);
    setIsLoadingMoreComments(false);
  }, [classId, supabase]);

  // Shared logins are used by many different people over time, so we
  // remember the last name typed on THIS device only (not per-account) —
  // a light convenience, never a substitute for asking each time.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(NAME_STORAGE_KEY);
      if (saved) setAuthorName(saved);
    } catch {
      // Commenting remains available when browser storage is disabled.
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    setIsLoading(true);
    setComments([]);
    commentsRef.current = [];
    setHasMoreComments(true);
    void loadComments("latest");

    // Live updates so a comment/reaction from another device shows up
    // without a manual refresh.
    const channel = supabase
      .channel(`comments-${classId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "comments", filter: `class_id=eq.${classId}` },
        () => { void loadComments("latest"); }
      )
      .subscribe();

    return () => {
      mountedRef.current = false;
      supabase.removeChannel(channel);
    };
  }, [classId, loadComments, supabase]);

  async function handlePost(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = authorName.trim();
    const trimmedContent = content.trim();

    if (!trimmedName) {
      setErrorMessage("Vui lòng nhập tên của bạn trước khi bình luận.");
      return;
    }
    if (!trimmedContent) {
      setErrorMessage("Bình luận không được để trống.");
      return;
    }

    setIsPosting(true);
    setErrorMessage(null);

    try {
      const { error } = await supabase.from("comments").insert({
        class_id: classId,
        author_name: trimmedName,
        content: trimmedContent,
        created_by: currentUserId,
      });
      if (error) throw error;
      try {
        window.localStorage.setItem(NAME_STORAGE_KEY, trimmedName);
      } catch {
        // This local convenience is optional; the comment has already posted.
      }
      setContent("");
    } catch {
      setErrorMessage("Không thể đăng bình luận. Vui lòng thử lại.");
    } finally {
      setIsPosting(false);
    }
  }

  async function handleReact(commentId: string, emoji: string) {
    setErrorMessage(null);
    // Optimistic update so the tap feels instant.
    setComments((prev) =>
      prev.map((c) =>
        c.id === commentId ? { ...c, reactions: { ...c.reactions, [emoji]: (c.reactions[emoji] ?? 0) + 1 } } : c
      )
    );
    try {
      const { error } = await supabase.rpc("toggle_comment_reaction", { p_comment_id: commentId, p_emoji: emoji });
      if (error) throw error;
    } catch {
      setComments((prev) => prev.map((comment) => {
        if (comment.id !== commentId) return comment;
        const remaining = Math.max(0, (comment.reactions[emoji] ?? 0) - 1);
        return { ...comment, reactions: { ...comment.reactions, [emoji]: remaining } };
      }));
      setErrorMessage("Không cập nhật được biểu cảm. Vui lòng thử lại.");
    }
  }

  return (
    <div className="rounded-xl border border-white/10 bg-black/40 p-5 md:backdrop-blur-md">
      <h3 className="mb-4 font-serif text-lg text-white">Góp ý &amp; bình luận của lớp</h3>

      {/* Composer — only meaningful for shared parent/student logins, but
          teachers can post too (e.g. to reply), so it's always shown. */}
      <form onSubmit={handlePost} className="mb-6 flex flex-col gap-3 rounded-lg bg-white/[0.03] p-4">
        <div className="flex flex-col gap-1.5">
          <label className="font-sans text-xs uppercase tracking-wider text-white/50">
            Tên của bạn {currentUserRole !== "teacher" && "(để GV biết ai đang góp ý)"}
          </label>
          <Input
            placeholder="Nhập tên của bạn để bình luận"
            value={authorName}
            onChange={(e) => setAuthorName(e.target.value)}
            maxLength={60}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="font-sans text-xs uppercase tracking-wider text-white/50">Nội dung</label>
          <textarea
            className="min-h-[80px] w-full rounded-md border border-white/15 bg-white/[0.04] p-3 text-sm text-white placeholder:text-white/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E3B23C]"
            placeholder="Viết bình luận, nhận xét hoặc góp ý cho lớp..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            maxLength={1000}
          />
        </div>
        {errorMessage && <p className="font-sans text-sm text-red-400">{errorMessage}</p>}
        <Button type="submit" disabled={isPosting} className="w-fit self-end">
          {isPosting ? "Đang đăng..." : "Đăng bình luận"}
        </Button>
      </form>

      {/* Feed */}
      {isLoading ? (
        <p className="py-6 text-center font-sans text-sm text-white/40">Đang tải bình luận...</p>
      ) : comments.length === 0 ? (
        <p className="py-6 text-center font-sans text-sm text-white/40">Chưa có bình luận nào. Hãy là người đầu tiên!</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {comments.map((comment) => (
            <motion.li
              key={comment.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-lg bg-white/[0.03] p-4"
            >
              <div className="mb-1 flex items-center justify-between">
                <span className="font-sans text-sm font-semibold text-white">{comment.author_name}</span>
                <span className="font-sans text-xs text-white/40">
                  {new Date(comment.created_at).toLocaleString("vi-VN")}
                </span>
              </div>
              <p className="mb-3 font-sans text-sm text-white/80">{comment.content}</p>

              <div className="flex flex-wrap gap-1.5">
                {REACTION_EMOJIS.map((emoji) => {
                  const count = comment.reactions[emoji] ?? 0;
                  return (
                    <button
                      key={emoji}
                      onClick={() => handleReact(comment.id, emoji)}
                      className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-xs text-white/70 transition hover:bg-white/10"
                    >
                      <span>{emoji}</span>
                      {count > 0 && <span className="text-white/50">{count}</span>}
                    </button>
                  );
                })}
              </div>
            </motion.li>
          ))}
        </ul>
      )}

      {!isLoading && hasMoreComments && comments.length > 0 && (
        <button
          type="button"
          onClick={() => { void loadComments("older"); }}
          disabled={isLoadingMoreComments}
          className="mt-4 min-h-11 w-full rounded-lg border border-white/10 bg-white/[0.025] font-sans text-xs text-white/55 transition hover:border-[#E3B23C]/30 hover:text-[#E3B23C] disabled:opacity-40"
        >
          {isLoadingMoreComments ? "Đang tải…" : "Tải thêm bình luận cũ"}
        </button>
      )}
    </div>
  );
}
