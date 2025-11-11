import dotenv from "dotenv"
import { AutoScalingClient, SetDesiredCapacityCommand, DescribeAutoScalingInstancesCommand, TerminateInstanceInAutoScalingGroupCommand } from "@aws-sdk/client-auto-scaling";
import express from "express"
import { EC2Client, DescribeInstancesCommand } from "@aws-sdk/client-ec2";


dotenv.config() 

const app = express()   
const client = new AutoScalingClient({ 
    region: "eu-north-1", 
    credentials:{
        accessKeyId: process.env.AWS_ACCESS_KEY !,
        secretAccessKey: process.env.AWS_ACCESS_SECRET_KEY !
}});

const ec2Client = new EC2Client({ 
    region: "eu-north-1", 
    credentials:{
        accessKeyId: process.env.AWS_ACCESS_KEY !,
        secretAccessKey: process.env.AWS_ACCESS_SECRET_KEY !
}})

type Machine = {
    ip: String,
    isUsed: boolean,
    assignedProject?: string | null
}

const ALL_MACHINES : Machine[] = []

async function refreshInstances() {
    const command = new DescribeAutoScalingInstancesCommand()
    const data = await client.send(command)
    const instanceIds = (data.AutoScalingInstances ?? [])
                        .map(x => x.InstanceId)
                        .filter((id): id is string => typeof id === "string");
  
    const ec2InstanceCommand = new DescribeInstancesCommand({
    InstanceIds: instanceIds,
    });

    const ec2Response = await ec2Client.send(ec2InstanceCommand)

    ec2Response.Reservations?.forEach(reservation => {
        reservation.Instances?.forEach(instance => {
          const publicIp =
            instance.PublicIpAddress ||
            instance.NetworkInterfaces?.[0]?.Association?.PublicIp ||
            "No Public IP found";

            const existing = ALL_MACHINES.find(m => m.ip === publicIp)
            if (!existing) {
                ALL_MACHINES.push({
                    ip: publicIp,
                    isUsed: false,
                    assignedProject: null
                })
            }
          console.log(publicIp);
        });
      });

}

refreshInstances()
setInterval(() => {
    refreshInstances()
}, 10*1000);


app.get("/:projectId", async(req, res)=>{
  const idleMachine = ALL_MACHINES.find(i=> i.isUsed == false)
  if (!idleMachine) {
    res.status(404).send("No idle machine found")
    return
  }
  idleMachine.isUsed = true;
  idleMachine.assignedProject = req.params.projectId;
  // Scale up the infra here 
    const command = new SetDesiredCapacityCommand({
        AutoScalingGroupName: "vscode-asg",
        DesiredCapacity: ALL_MACHINES.length + (5 - ALL_MACHINES.filter( x => x.isUsed == false ).length)
    })

    const data = await client.send(command)
    console.log(data)

    res.send({
        ip: idleMachine.ip
    })


})

app.post("/destroy", (req, res)=>{
    const machineId = req.body.machineId;

    const command = new TerminateInstanceInAutoScalingGroupCommand({
        InstanceId: machineId,
        ShouldDecrementDesiredCapacity: true
    })

    client.send(command)
})

app.listen(9092)