import { SetMetadata } from "@nestjs/common";
import type { Permission } from "@erp/shared";

export const IS_PUBLIC = "erp:public";
export const REQUIRED_PERMISSION = "erp:permission";

/** Endpoint tanpa autentikasi. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Endpoint yang mensyaratkan permission tertentu. */
export const RequirePermission = (permission: Permission) => SetMetadata(REQUIRED_PERMISSION, permission);
export const ALLOW_INACTIVE = "erp:allow-inactive";
export const PLATFORM_ADMIN = "erp:platform-admin";

/** Tetap bisa menulis walau langganan berakhir (halaman langganan, akun sendiri). */
export const AllowInactive = () => SetMetadata(ALLOW_INACTIVE, true);
/** Khusus admin platform (operator SaaS), bukan admin tenant. */
export const PlatformAdmin = () => SetMetadata(PLATFORM_ADMIN, true);
