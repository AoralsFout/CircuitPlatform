#pragma once

#include "circuit/circuit.hpp"
#include "circuit/engine.hpp"
#include "circuit/protocol.hpp"
#include "circuit/simulation.hpp"

#include <optional>
#include <string>

namespace circuit {

/**
 * 处理一条已经解析的 JSON Lines 请求并返回完整 JSON 响应。
 * @param request 已由 protocol::parseRequest 解析且包含 type/requestId 的请求。
 * @param engine 用于返回健康检查信息的引擎身份。
 * @param circuit 当前会话持有的电路结构；结构删除保留悬空连接。
 * @param simulation 当前电路的仿真快照；每次结构变化后会重建。
 * @return 与请求 requestId 对应的一行 JSON 响应；业务失败也以 error 响应返回。
 */
[[nodiscard]] std::string handleRequest(
    const protocol::Request& request, const Engine& engine, Circuit& circuit,
    std::optional<Simulation>& simulation);

}  // namespace circuit
