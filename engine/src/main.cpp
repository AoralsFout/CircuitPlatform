#include "circuit/engine.hpp"
#include "circuit/protocol.hpp"
#include "circuit/simulation.hpp"

#include <iostream>
#include <optional>
#include <string>
#include <string_view>

namespace {

using circuit::ComponentKind;
using circuit::SignalValue;
using circuit::protocol::Request;

// 将协议中的稳定名称映射到领域枚举，避免协议字符串进入仿真核心。
std::optional<ComponentKind> componentKindFromName(std::string_view name) {
    if (name == "input") return ComponentKind::Input;
    if (name == "output") return ComponentKind::Output;
    if (name == "and") return ComponentKind::AndGate;
    if (name == "or") return ComponentKind::OrGate;
    if (name == "nand") return ComponentKind::NandGate;
    if (name == "nor") return ComponentKind::NorGate;
    if (name == "xor") return ComponentKind::XorGate;
    if (name == "xnor") return ComponentKind::XnorGate;
    if (name == "not") return ComponentKind::NotGate;
    if (name == "clock") return ComponentKind::Clock;
    if (name == "d_flip_flop") return ComponentKind::DFlipFlop;
    return std::nullopt;
}

std::optional<SignalValue> signalValueFromName(std::string_view value) {
    if (value == "0") return SignalValue::Zero;
    if (value == "1") return SignalValue::One;
    if (value == "X") return SignalValue::Unknown;
    return std::nullopt;
}

// 协议允许用数字表达确定值，用字符串 X 表达未知值。
std::string signalValueToJson(SignalValue value) {
    switch (value) {
    case SignalValue::Zero: return "0";
    case SignalValue::One: return "1";
    case SignalValue::Unknown: return "\"X\"";
    }
    return "\"X\"";
}

std::string responseWithId(std::string_view type, std::string_view requestId) {
    return "{\"type\":\"" + circuit::protocol::escapeJson(type) +
           "\",\"requestId\":\"" + circuit::protocol::escapeJson(requestId) + "\"";
}

std::string missingField(const Request& request, std::string_view field) {
    return circuit::protocol::errorResponse(
        request.requestId, "bad_request", "缺少字段: " + std::string(field));
}

// 结构变化后丢弃旧快照，保证 Simulation 不会继续使用过期 Circuit。
void resetSimulation(const circuit::Circuit& circuit, std::optional<circuit::Simulation>& simulation) {
    simulation.emplace(circuit);
}

std::string handleRequest(
    const Request& request, const circuit::Engine& engine, circuit::Circuit& circuit,
    std::optional<circuit::Simulation>& simulation) {
    if (request.type == "health_check") {
        const auto status = engine.status();
        return responseWithId("health_check_result", request.requestId) +
               ",\"status\":\"ok\",\"engine\":\"" +
               circuit::protocol::escapeJson(std::string(status.name) + " " + std::string(status.version)) +
               "\"}";
    }

    if (request.type == "add_component") {
        if (!request.kind.has_value()) return missingField(request, "kind");
        const auto kind = componentKindFromName(*request.kind);
        if (!kind.has_value()) {
            return circuit::protocol::errorResponse(request.requestId, "invalid_kind", "不支持的元件类型");
        }

        const auto id = circuit.addComponent(*kind);
        resetSimulation(circuit, simulation);
        return responseWithId("component_added", request.requestId) +
               ",\"componentId\":" + std::to_string(id) + "}";
    }

    if (request.type == "add_connection") {
        if (!request.sourceComponentId.has_value()) return missingField(request, "sourceComponentId");
        if (!request.sourcePort.has_value()) return missingField(request, "sourcePort");
        if (!request.targetComponentId.has_value()) return missingField(request, "targetComponentId");
        if (!request.targetPort.has_value()) return missingField(request, "targetPort");

        const auto result = circuit.addConnection(
            {*request.sourceComponentId, *request.sourcePort},
            {*request.targetComponentId, *request.targetPort});
        if (!result.succeeded()) {
            return circuit::protocol::errorResponse(
                request.requestId, "invalid_connection", "连接端点不符合 Circuit 规则");
        }

        resetSimulation(circuit, simulation);
        return responseWithId("connection_added", request.requestId) +
               ",\"connectionId\":" + std::to_string(*result.id) + "}";
    }

    if (request.type == "set_input") {
        if (!request.componentId.has_value()) return missingField(request, "componentId");
        if (!request.value.has_value()) return missingField(request, "value");
        const auto value = signalValueFromName(*request.value);
        if (!value.has_value()) {
            return circuit::protocol::errorResponse(request.requestId, "invalid_signal", "信号值必须是 0、1 或 X");
        }

        if (!simulation.has_value()) resetSimulation(circuit, simulation);
        if (!simulation->setInput(*request.componentId, *value)) {
            return circuit::protocol::errorResponse(request.requestId, "invalid_input", "目标元件不是有效的 Input");
        }

        return responseWithId("input_set", request.requestId) + "}";
    }

    if (request.type == "settle") {
        if (!simulation.has_value()) resetSimulation(circuit, simulation);
        const auto result = simulation->settle();
        if (!result.succeeded()) {
            return circuit::protocol::errorResponse(request.requestId, "combinational_loop", "检测到组合逻辑环路");
        }
        return responseWithId("settled", request.requestId) + ",\"status\":\"ok\"}";
    }

    if (request.type == "get_signal") {
        if (!request.componentId.has_value()) return missingField(request, "componentId");
        if (!request.port.has_value()) return missingField(request, "port");
        if (!simulation.has_value()) resetSimulation(circuit, simulation);

        const auto signal = simulation->signal({*request.componentId, *request.port});
        if (!signal.has_value()) {
            return circuit::protocol::errorResponse(request.requestId, "port_not_found", "找不到目标端口");
        }
        return responseWithId("signal_result", request.requestId) +
               ",\"value\":" + signalValueToJson(*signal) + "}";
    }

    return circuit::protocol::errorResponse(request.requestId, "unsupported_message", "不支持的消息类型");
}

}  // namespace

// 持续读取 JSON Lines 请求；每行只产生一行响应，便于 Electron 维护长连接。
int main() {
    const circuit::Engine engine;
    circuit::Circuit circuit;
    std::optional<circuit::Simulation> simulation;
    std::string line;

    while (std::getline(std::cin, line)) {
        const auto request = circuit::protocol::parseRequest(line);
        if (!request.has_value()) {
            std::cout << circuit::protocol::errorResponse("", "bad_json", "请求必须包含有效的 type 和 requestId")
                      << std::endl;
            continue;
        }

        std::cout << handleRequest(*request, engine, circuit, simulation) << std::endl;
    }

    return 0;
}
