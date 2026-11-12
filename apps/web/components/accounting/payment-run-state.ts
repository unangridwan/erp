/** Label status payment run. */
export const RUN_STATE: Record<string, [string, string]> = {
  draft: ["Draft", "Draft"],
  in_approval: ["Menunggu persetujuan", "Awaiting approval"],
  approved: ["Disetujui", "Approved"],
  done: ["Dieksekusi", "Executed"],
  cancel: ["Dibatalkan", "Cancelled"],
};
