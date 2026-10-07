/** Stable business API names; exposure changes never rename these operations. */
export const TEAM_TOOL_NAMES = [
    'agent_teams_create', 'agent_teams_approve', 'agent_teams_edit_plan',
    'agent_teams_add_member', 'agent_teams_remove_member', 'agent_teams_create_task',
    'agent_teams_reassign_task', 'agent_teams_claim_task', 'agent_teams_update_task',
    'agent_teams_amend_task',
    // ★ 交付的【宣告点】（t18/B2）：读取（status）只报告，宣告才被拒绝。
    'agent_teams_declare_delivery',
    'agent_teams_send_message', 'agent_teams_status', 'agent_teams_resume', 'agent_teams_delete',
    // ★ captain-only 的【重载】（t24）。必须登记，否则「captain-only」只在运行时成立、
    //   在【可见性】上不成立：成员会看见它，调用后得到一句误导性的话
    //   （"you are not leading any team yet" —— 而真相是"你没资格"，不是"你还没建队"）。
    //
    //   MEASURED（t24）：deny 列表由 TEAM_TOOL_NAMES 减去 MEMBER_TOOL_NAMES 算出，
    //   所以【没进这张表 = 没进 deny 列表 = 成员看得见】。
    //
    //   ★★ 而它与【实现】必须同时在场 —— captain 先只加了这一行（实现还在 worktree 里），
    //   capabilities 从 6/18 掉到 3/18：表里有它、实现里没有它。
    //   ⇒ 一个新工具的上线是【两处同时】的动作，不是一个"事后补登记"。
    //     而这条不变量正是这个缺口本身要修的：captain-only 必须在两处都成立。
    'agent_teams_restart',
];
export const MEMBER_TOOL_NAMES = [
    'agent_teams_claim_task', 'agent_teams_update_task', 'agent_teams_send_message', 'agent_teams_status',
];
export const CAPTAIN_TOOL_NAMES = TEAM_TOOL_NAMES.filter(name => !MEMBER_TOOL_NAMES.includes(name));
