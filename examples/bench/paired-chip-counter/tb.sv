module tb;
  reg clk = 0, rst = 1, enable = 0;
  wire [3:0] count;
  counter dut(clk, rst, enable, count);
  task tick;
    begin #1; clk = 1; #1; clk = 0; #1; end
  endtask
  initial begin
    tick;
    if (count !== 0) $fatal(1, "reset failed");
    rst = 0;
    repeat(3) tick;
    if (count !== 0) $fatal(1, "disabled counter changed");
    enable = 1;
    repeat(15) tick;
    if (count !== 15) $fatal(1, "enabled count failed");
    tick;
    if (count !== 0) $fatal(1, "wrap failed");
    enable = 0; repeat(2) tick;
    if (count !== 0) $fatal(1, "hold after wrap failed");
    rst = 1; enable = 1; tick;
    if (count !== 0) $fatal(1, "reset priority failed");
    $finish;
  end
endmodule
