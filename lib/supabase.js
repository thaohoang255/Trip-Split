import { createClient } from "@supabase/supabase-js";

// Tạo "đường dây nói chuyện" với Supabase, dùng chung cho cả app.
// 2 giá trị này được đọc từ file .env.local — không viết chết trong code.
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);
