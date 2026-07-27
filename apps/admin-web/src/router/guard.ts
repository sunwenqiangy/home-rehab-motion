import { Router } from 'vue-router';
import { hasPermission } from '@/utils/permission';

const WHITE_LIST = ['/login'];

/**
 * 菜单 key 映射：路径前缀 -> 权限 key
 */
const PATH_PERMISSION_MAP: Record<string, string> = {
  '/videos': 'videos',
  '/flow-verify': 'flow-verify',
  '/guidance': 'guidance',
  '/feedback': 'feedback',
  '/thresholds': 'thresholds',
  '/accounts': 'accounts',
};

function getPathPermissionKey(path: string): string | null {
  for (const prefix of Object.keys(PATH_PERMISSION_MAP)) {
    if (path.startsWith(prefix)) return PATH_PERMISSION_MAP[prefix];
  }
  return null;
}

export function setupRouterGuard(router: Router): void {
  router.beforeEach((to, _from, next) => {
    const token = localStorage.getItem('admin_token');

    if (WHITE_LIST.includes(to.path)) {
      // 已登录访问登录页 -> 跳转首页
      if (token) {
        next({ path: '/' });
        return;
      }
      next();
      return;
    }

    // 未登录 -> 跳转登录页
    if (!token) {
      next({ path: '/login', query: { redirect: to.fullPath } });
      return;
    }

    // 角色权限校验
    const permKey = getPathPermissionKey(to.path);
    if (permKey && !hasPermission(permKey)) {
      next({ path: '/dashboard' });
      return;
    }

    next();
  });
}
