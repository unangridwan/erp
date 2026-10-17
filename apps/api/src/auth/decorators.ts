import { SetMetadata } from "@nestjs/common";
import type { Permission } from "@erp/shared";

export const IS_PUBLIC = "erp:public";
export const REQUIRED_PERMISSION = "erp:permission";

/** Endpoint tanpa autentikasi. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Endpoint yang mensyaratkan permission tertentu. */
export const RequirePermission = (permission: Permission) => SetMetadata(REQUIRED_PERMISSION, permission);
