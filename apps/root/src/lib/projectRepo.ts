/**
 * 專案 GitHub 欄位的前台顯示判斷。
 *
 * 私人 repo 一律不輸出網址（即使 github 欄位有值），改顯示不可點的私人標示；
 * 非私人且無網址時不顯示任何東西。
 */

export type ProjectRepoDisplay =
  | { kind: 'link'; href: string; display: string }
  | { kind: 'private'; label: string }
  | null;

interface ProjectRepoSource {
  isPrivateRepo?: boolean;
  links?: { github?: string | null } | null;
}

export function resolveProjectRepo(
  project: ProjectRepoSource,
  locale: string
): ProjectRepoDisplay {
  if (project.isPrivateRepo) {
    return {
      kind: 'private',
      label: locale === 'zh-tw' ? '私人儲存庫' : 'Private repository',
    };
  }
  const href = project.links?.github?.trim();
  if (!href) return null;
  return { kind: 'link', href, display: href.replace('https://', '') };
}
