#include "circuit/request_handler.hpp"

#include <cstddef>
#include <optional>
#include <string>
#include <string_view>

namespace circuit {
namespace {

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

/**
 * 把协议里的信号值文本翻译成领域值。
 * @param value 逐位文本，每一位取 `0` / `1` / `X`。
 * @return 合法时返回领域值；空串或含其它字符时返回空值。
 */
std::optional<SignalValue> signalValueFromName(std::string_view value) {
    if (value.empty() || value.find_first_not_of("01X") != std::string_view::npos) {
        return std::nullopt;
    }
    return SignalValue::fromBits(std::string(value));
}

// 信号值出协议时统一是字符串，逐位文本因此直接加引号。文本只含 `0` / `1` / `X`，
// 没有需要转义的字符。
std::string signalValueToJson(const SignalValue& value) {
    return "\"" + value.bits() + "\"";
}

/**
 * 本票所有端口的位宽恒为 1。位宽成为 `Port` 的属性后（Phase 4.5 的下一票），这个常量
 * 换成读目标端口声明的位宽。
 */
constexpr std::size_t portWidth = 1;

std::string responseWithId(std::string_view type, std::string_view requestId) {
    return "{\"type\":\"" + protocol::escapeJson(type) +
           "\",\"requestId\":\"" + protocol::escapeJson(requestId) + "\"";
}

std::string missingField(const protocol::Request& request, std::string_view field) {
    return protocol::errorResponse(
        request.requestId, "bad_request", "缺少字段: " + std::string(field));
}

// 从零建立一份仿真状态，等价于「刚创建时」的样子：全部输出回到初始值、Clock 回到 0、
// 每个 DFlipFlop 的 q 回到 X、步数归零。首次需要仿真时走这里；重置同样以它为基底。
void resetSimulation(const Circuit& circuit, std::optional<Simulation>& simulation) {
    simulation.emplace(circuit);
}

// 结构变化后按元件身份重新推导仿真状态，而不是重建整个快照。
// Simulation 持有对 Circuit 的引用，所以这里只需要重建状态表：仍然存在的 PortId 保留当前值，
// 消失的连同值一起丢弃，新出现的按初始值建立，已经积累的时序状态不受影响。
void reconcileSimulation(const Circuit& circuit, std::optional<Simulation>& simulation) {
    if (!simulation.has_value()) {
        resetSimulation(circuit, simulation);
        return;
    }

    simulation->reconcile();
}

}  // namespace

std::string handleRequest(
    const protocol::Request& request, const Engine& engine, Circuit& circuit,
    std::optional<Simulation>& simulation) {
    if (request.type == "health_check") {
        const auto status = engine.status();
        return responseWithId("health_check_result", request.requestId) +
               ",\"status\":\"ok\",\"engine\":\"" +
               protocol::escapeJson(std::string(status.name) + " " + std::string(status.version)) +
               "\"}";
    }

    if (request.type == "add_component") {
        if (!request.kind.has_value()) return missingField(request, "kind");
        const auto kind = componentKindFromName(*request.kind);
        if (!kind.has_value()) {
            return protocol::errorResponse(request.requestId, "invalid_kind", "不支持的元件类型");
        }

        const auto id = circuit.addComponent(*kind);
        reconcileSimulation(circuit, simulation);
        return responseWithId("component_added", request.requestId) +
               ",\"componentId\":" + std::to_string(id) + "}";
    }

    if (request.type == "remove_component") {
        if (!request.componentId.has_value()) return missingField(request, "componentId");
        if (*request.componentId == 0) {
            return protocol::errorResponse(
                request.requestId, "bad_request", "componentId 必须是正整数");
        }
        if (!circuit.removeComponent(*request.componentId)) {
            return protocol::errorResponse(request.requestId, "component_not_found", "找不到元件");
        }

        reconcileSimulation(circuit, simulation);
        return responseWithId("component_removed", request.requestId) +
               ",\"componentId\":" + std::to_string(*request.componentId) + "}";
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
            return protocol::errorResponse(
                request.requestId, "invalid_connection", "连接端点不符合 Circuit 规则");
        }

        reconcileSimulation(circuit, simulation);
        return responseWithId("connection_added", request.requestId) +
               ",\"connectionId\":" + std::to_string(*result.id) + "}";
    }

    if (request.type == "remove_connection") {
        if (!request.connectionId.has_value()) return missingField(request, "connectionId");
        if (*request.connectionId == 0) {
            return protocol::errorResponse(
                request.requestId, "bad_request", "connectionId 必须是正整数");
        }
        if (!circuit.removeConnection(*request.connectionId)) {
            return protocol::errorResponse(request.requestId, "connection_not_found", "找不到连接");
        }

        reconcileSimulation(circuit, simulation);
        return responseWithId("connection_removed", request.requestId) +
               ",\"connectionId\":" + std::to_string(*request.connectionId) + "}";
    }

    if (request.type == "set_input") {
        if (!request.componentId.has_value()) return missingField(request, "componentId");
        if (!request.value.has_value()) return missingField(request, "value");
        const auto value = signalValueFromName(*request.value);
        if (!value.has_value()) {
            return protocol::errorResponse(request.requestId, "invalid_signal", "信号值必须是 0、1 或 X");
        }
        // 长度先按字符集判定再按位宽判定：空串与含其它字符的值连信号值都不是，报 invalid_signal；
        // 只含 0/1/X 但长度不对的值本身合法，只是放不进这个端口，报 invalid_width。
        if (value->width() != portWidth) {
            return protocol::errorResponse(
                request.requestId, "invalid_width", "信号值长度必须等于端口位宽");
        }

        if (!simulation.has_value()) resetSimulation(circuit, simulation);
        if (!simulation->setInput(*request.componentId, *value)) {
            return protocol::errorResponse(request.requestId, "invalid_input", "目标元件不是有效的 Input");
        }

        return responseWithId("input_set", request.requestId) + "}";
    }

    if (request.type == "settle") {
        if (!simulation.has_value()) resetSimulation(circuit, simulation);
        const auto result = simulation->settle();
        if (!result.succeeded()) {
            return protocol::errorResponse(request.requestId, "combinational_loop", "检测到组合逻辑环路");
        }
        return responseWithId("settled", request.requestId) + ",\"status\":\"ok\"}";
    }

    if (request.type == "tick") {
        if (!simulation.has_value()) resetSimulation(circuit, simulation);
        const auto result = simulation->tick();
        if (!result.succeeded()) {
            return protocol::errorResponse(request.requestId, "combinational_loop", "检测到组合逻辑环路");
        }

        // 一次推进就把全部输出端口与每个 Output 接收端的当前值带回，运行循环每步只有一次跨进程往返。
        std::string signals = ",\"signals\":[";
        bool first = true;
        for (const auto& signal : simulation->signalSnapshot()) {
            if (!first) signals += ",";
            first = false;
            signals += "{\"componentId\":" + std::to_string(signal.port.component) +
                       ",\"port\":\"" + protocol::escapeJson(signal.port.name) + "\",\"value\":" +
                       signalValueToJson(signal.value) + "}";
        }
        signals += "]}";

        return responseWithId("ticked", request.requestId) +
               ",\"step\":" + std::to_string(simulation->step()) + signals;
    }

    if (request.type == "reset") {
        // 重置是一条独立请求，不是推进的一个参数：用户要能在任何时候单独表达「从头来过」，
        // 而不必借道某个带副作用的操作。它只清空运行时状态，Circuit 结构原样保留。
        // 没有仿真时先按当前 Circuit 建立再重置，结果与「重建一份仿真」完全一致。
        if (!simulation.has_value()) resetSimulation(circuit, simulation);
        simulation->reset();
        return responseWithId("reset_done", request.requestId) + ",\"status\":\"ok\"}";
    }

    if (request.type == "get_signal") {
        if (!request.componentId.has_value()) return missingField(request, "componentId");
        if (!request.port.has_value()) return missingField(request, "port");
        if (!simulation.has_value()) resetSimulation(circuit, simulation);

        const auto signal = simulation->signal({*request.componentId, *request.port});
        if (!signal.has_value()) {
            return protocol::errorResponse(request.requestId, "port_not_found", "找不到目标端口");
        }
        return responseWithId("signal_result", request.requestId) +
               ",\"value\":" + signalValueToJson(*signal) + "}";
    }

    return protocol::errorResponse(request.requestId, "unsupported_message", "不支持的消息类型");
}

}  // namespace circuit
